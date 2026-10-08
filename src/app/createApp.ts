import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import mongoose from 'mongoose';
import Routes from '@/routes';
import * as Exception from '@/app/exception';

export function createApp({ logging = false } = {}) {
    const app = express();

    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use(cors());
    if (logging) app.use(morgan('dev'));

    app.use('/public', express.static('public'));

    // Once disconnected, reject new work instead of buffering writes until later.
    app.use('/api', (_req, res, next) => {
        if (mongoose.connection.readyState !== 1) {
            res.set('Cache-Control', 'no-store').status(503).send({
                status: false, message: '資料服務暫時無法使用，請稍後再試'
            });
            return;
        }
        next();
    });
    app.use(Routes);

    app.use(Exception.sendNotFoundError);
    app.use(Exception.catchCustomError);

    return app;
}
