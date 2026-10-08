import type { RequestHandler } from 'express';
import bcrypt from 'bcryptjs';
import createHttpError from 'http-errors';
import UsersModel from '@/models/user';
import { generateToken, verifyToken } from '@/utils';

export const signup: RequestHandler = async (req, res, next) => {
    try {
        const { name, email, password, phone, birthday, address } = req.body;

        const checkEmail = await UsersModel.findOne({ email });
        if (checkEmail) {
            throw createHttpError(400, '此 Email 已註冊');
        }

        const _result = await UsersModel.create({
            name,
            email,
            phone,
            birthday,
            address,
            password: await bcrypt.hash(password, 6)
        });
        const {
            password: _,
            verificationToken: _verificationToken,
            ...result
        } = _result.toObject();

        res.send({
            status: true,
            token: generateToken({ userId: result._id }),
            result
        });
    } catch (error) {
        next(error);
    }
};

export const login: RequestHandler = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        const user = await UsersModel.findOne({ email }).select('+password');
        if (!user) {
            throw createHttpError(404, '此使用者不存在');
        }

        const checkPassword = await bcrypt.compare(password, user.password);
        if (!checkPassword) {
            throw createHttpError(400, '密碼錯誤');
        }

        const { password: _, ...result } = user.toObject();

        res.send({
            status: true,
            token: generateToken({ userId: user._id }),
            result
        });
    } catch (error) {
        next(error);
    }
};

export const forget: RequestHandler = async (req, res, next) => {
    try {
        const { email, code, newPassword } = req.body;

        const user = await UsersModel.findOne({ email }).select('+verificationToken');
        if (!user) {
            throw createHttpError(404, '此使用者不存在');
        }

        let payload;
        try {
            payload = verifyToken(user.verificationToken);
        } catch {
            throw createHttpError(400, '驗證碼已失效，請重新取得');
        }
        if (!code || payload.code !== code) throw createHttpError(400, '請至 Email 確認驗證碼');
        // Consume the exact token atomically so parallel/replayed requests cannot reuse it.
        const updated = await UsersModel.findOneAndUpdate(
            { _id: user._id, verificationToken: user.verificationToken },
            { password: await bcrypt.hash(newPassword, 6), verificationToken: '' }
        );
        if (!updated) throw createHttpError(400, '驗證碼已失效，請重新取得');

        res.send({
            status: true
        });
    } catch (error) {
        next(error);
    }
};

export const check: RequestHandler = async (req, res) => {
    const token = `${req.headers.authorization?.replace('Bearer ', '')}`;
    res.send({
        status: true,
        token
    });
};

export const getInfo: RequestHandler = async (req, res) => {
    res.send({
        status: true,
        result: req.user
    });
};

export const updateInfo: RequestHandler = async (req, res, next) => {
    try {
        const { userId, oldPassword, newPassword } = req.body;
        if (userId && String(userId) !== String(req.user?._id)) {
            throw createHttpError(403, '無法修改其他會員資料');
        }
        const user = await UsersModel.findById(req.user?._id).select('+password');
        if (!user) throw createHttpError(401, '請重新登入');
        if (oldPassword !== undefined || newPassword !== undefined) {
            if (!oldPassword || !newPassword) throw createHttpError(400, '請填寫舊密碼與新密碼');
            if (!(await bcrypt.compare(oldPassword, user.password)))
                throw createHttpError(400, '密碼錯誤');
            user.password = await bcrypt.hash(newPassword, 6);
        }
        for (const field of ['name', 'phone', 'birthday', 'address'] as const) {
            if (req.body[field] !== undefined) user.set(field, req.body[field]);
        }
        // Validate and persist all fields together: failed profile edits must not change passwords.
        await user.save();
        const { password: _, verificationToken: _verificationToken, ...result } = user.toObject();
        res.send({ status: true, result });
    } catch (error) {
        next(error);
    }
};
