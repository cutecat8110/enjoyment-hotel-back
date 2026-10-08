import type { RequestHandler } from 'express';
import createHttpError from 'http-errors';
import validator from 'validator';
import { isObjectIdOrHexString } from 'mongoose';
import { parseStayDate, todayInTaipei } from '@/utils/stayDates';
import RoomModel from '@/models/room';
import UsersModel from '@/models/user';
import { verifyToken } from '@/utils';

// token 驗證
export const isAuth: RequestHandler = async (req, _res, next) => {
    /**
     * #swagger.security = [{ "bearerAuth": [] }]
     * #swagger.responses[403] = {
            description: '重新登入',
            schema: {
                "status": false,
                "message": "請重新登入",
            }
        }
     */
    try {
        const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
        const result = verifyToken(token);

        if (!isObjectIdOrHexString(result.userId)) throw createHttpError(401, '請重新登入');
        const user = await UsersModel.findById(result.userId);
        if (!user) {
            throw createHttpError(401, '請重新登入');
        }

        req.user ??= user;

        next();
    } catch (error) {
        next(error);
    }
};

// Missing roles remain regular members; public signup cannot grant this role.
export const isAdmin: RequestHandler = (req, res, next) => {
    isAuth(req, res, (error) => {
        if (error) return next(error);
        if (req.user?.role !== 'admin') return next(createHttpError(403, '需要管理員權限'));
        return next();
    });
};

export const checkRequestBodyValidator: RequestHandler = (req, _res, next) => {
    try {
        for (let [key, value] of Object.entries(req.body)) {
            if (value === undefined || value === null) {
                throw new Error('欄位未填寫正確');
            }

            const _value = `${value}`;

            switch (key) {
                case 'name':
                    if (!validator.isLength(_value, { min: 2 })) {
                        throw new Error('name 至少 2 個字元以上');
                    }
                    break;
                case 'email':
                    if (!validator.isEmail(_value)) {
                        throw new Error('Email 格式不正確');
                    }
                    break;
                case 'password':
                case 'newPassword':
                    if (!validator.isLength(_value, { min: 8 })) {
                        throw new Error('密碼需至少 8 碼以上');
                    }
                    if (validator.isAlpha(_value)) {
                        throw new Error('密碼不能只有英文');
                    }
                    if (validator.isNumeric(_value)) {
                        throw new Error('密碼不能只有數字');
                    }
                    if (!validator.isAlphanumeric(_value)) {
                        throw new Error('密碼需至少 8 碼以上，並英數混合');
                    }
                    break;
                case 'image':
                    if (!validator.isURL(_value, { protocols: ['https'] })) {
                        throw new Error('image 格式不正確');
                    }
                    break;
                default:
                    break;
            }
        }

        next();
    } catch (error) {
        next(error);
    }
};

export const checkOrder: RequestHandler = async (req, _res, next) => {
    try {
        const { roomId, checkInDate, checkOutDate, peopleNum } = req.body;

        if (!isObjectIdOrHexString(roomId)) throw createHttpError(400, 'roomId 格式錯誤');
        const roomInfo = await RoomModel.findOne({
            _id: roomId,
            status: 1
        }).select('maxPeople').lean();

        if (!roomInfo) {
            throw createHttpError(404, '此房型不存在');
        }

        if (!Number.isInteger(peopleNum) || peopleNum < 1 || peopleNum > roomInfo.maxPeople) {
            throw createHttpError(400, 'peopleNum 錯誤');
        }
        const checkIn = parseStayDate(checkInDate);
        const checkOut = parseStayDate(checkOutDate);
        if (!checkIn) throw createHttpError(400, 'checkInDate 格式錯誤');
        if (!checkOut) throw createHttpError(400, 'checkOutDate 格式錯誤');
        if (checkIn < todayInTaipei() || checkOut <= checkIn) {
            throw createHttpError(400, '入住不得早於今天，退房需晚於入住日期');
        }
        req.body.checkInDate = checkIn;
        req.body.checkOutDate = checkOut;

        next();
    } catch (error) {
        next(error);
    }
};
