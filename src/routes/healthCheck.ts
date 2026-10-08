import express, { Router } from 'express';
import mongoose from 'mongoose';

const router = Router();

router.get('/', (req, res) => {
    const ready = mongoose.connection.readyState === 1;
    const healthCheck = {
        status: ready,
        message: ready ? 'OK' : '資料服務暫時無法使用',
        uptime: process.uptime(),
        timestamp: Date.now(),
        host: req.headers.host
    };
    res.set('Cache-Control', 'no-store').status(ready ? 200 : 503).send(healthCheck);
});

router.use('/favicon.ico', express.static('public/favicon.ico'));

export default router;
