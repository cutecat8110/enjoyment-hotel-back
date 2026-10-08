import type { RequestHandler } from 'express';
import validator from 'validator';
import createHttpError from 'http-errors';
import nodemailer from 'nodemailer';
import UsersModel from '@/models/user';
import { generateEmailToken } from '@/utils';

export const checkEmailExists: RequestHandler = async (req, res, next) => {
    try {
        const email = req.body.email;

        if (typeof email !== 'string' || !validator.isEmail(email)) {
            throw new Error('Email 格式不正確');
        }

        const result = await UsersModel.exists({ email });

        res.send({
            status: true,
            result: {
                isEmailExists: Boolean(result)
            }
        });
    } catch (error) {
        next(error);
    }
};

export const sendVerificationCode: RequestHandler = async (req, res, next) => {
    try {
        const email = req.body.email;
        if (typeof email !== 'string' || !validator.isEmail(email)) {
            throw createHttpError(400, 'Email 格式不正確');
        }
        const { code, token } = generateEmailToken();

        const user = await UsersModel.findOne({ email }).select('_id').lean();

        if (user) {
            try {
                const transporter = getTransporter();
                await transporter.sendMail({
                    from: process.env.EMAILER_USER,
                    to: email,
                    subject: 'Node 驗證碼',
                    html: `<p>使用 ${code} 做為 Node 帳戶密碼安全性驗證碼</p>`
                });
            } catch {
                throw createHttpError(503, '寄信服務暫時無法使用，請稍後再試');
            }
            // Keep a previously issued code valid if the mail provider fails.
            await UsersModel.findByIdAndUpdate(user._id, { verificationToken: token });
        }

        res.send({
            status: true
        });
    } catch (error) {
        next(error);
    }
};

const getTransporter = () => {
    const { EMAILER_USER, EMAILER_PASSWORD } = process.env;

    if (!EMAILER_USER || !EMAILER_PASSWORD) {
        throw new Error('Email 服務未啟用');
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 20000,
        auth: {
            user: EMAILER_USER,
            pass: EMAILER_PASSWORD
        }
    });

    return transporter;
};
