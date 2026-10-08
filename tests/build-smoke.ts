import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Room from '../src/models/room';
import Order from '../src/models/order';

const baseEnv = { ...process.env, NODE_ENV: 'production',
    JWT_SECRET: 'isolated-build-test-secret', JWT_EXPIRES_DAY: '1d',
    DATABASE_PASSWORD: '', EMAILER_USER: '', EMAILER_PASSWORD: '' };

test('built entry point refuses invalid database configuration without listening or leaking it', async () => {
    const child = spawn(process.execPath, ['dist/index.js'], {
        env: { ...baseEnv, DATABASE: 'invalid-uri-with-private-setting', PORT: '0' }
    });
    let output = '';
    child.stdout.on('data', data => output += data);
    child.stderr.on('data', data => output += data);
    const timer = setTimeout(() => child.kill(), 10000);
    const [code] = await once(child, 'exit');
    clearTimeout(timer);
    assert.equal(code, 1);
    assert.match(output, /服務未啟動/);
    assert.doesNotMatch(output, /listening|invalid-uri-with-private-setting/);
});
test('production bundle serves real HTTP, registration, login and persisted bookings', async () => {
    const db = await MongoMemoryServer.create({ binary: { version: '7.0.24' } });
    let child: ReturnType<typeof spawn> | undefined;
    try {
        await mongoose.connect(db.getUri());
        const room = await Room.create({ name: 'Build QA room', description: 'isolated',
            imageUrl: 'https://example.com/qa.jpg', areaInfo: '10坪', bedInfo: '雙人床', maxPeople: 2, price: 3000 });
        // Let the OS choose an available port before starting the production entry point.
        const reservation = createServer().listen(0, '127.0.0.1');
        await once(reservation, 'listening');
        const port = (reservation.address() as { port: number }).port;
        await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
        child = spawn(process.execPath, ['dist/index.js'], {
            env: { ...baseEnv, DATABASE: db.getUri(), PORT: String(port) }
        });
        let output = '';
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Build startup timed out')), 10000);
            child!.once('error', reject);
            child!.once('exit', code => { clearTimeout(timer); reject(new Error(`Build exited: ${code}`)); });
            child!.stderr!.on('data', data => output += data);
            child!.stdout!.on('data', data => {
                output += data;
                if (output.includes('listening on')) { clearTimeout(timer); resolve(); }
            });
        });
        const api = request(`http://127.0.0.1:${port}`);
        await api.get('/').expect(200);
        await api.get('/api/v1/rooms').expect(200);
        await api.get('/api/v1/user/check').expect(401);
        const profile = { name: 'Build QA', email: 'build-qa@example.com', password: 'ExampleQA2026',
            phone: '0912345678', birthday: '1990-02-28', address: { zipcode: 100, detail: 'QA' } };
        const user = (await api.post('/api/v1/user/signup').send(profile).expect(200)).body;
        await api.post('/api/v1/user/login').send({ email: profile.email, password: profile.password }).expect(200);
        await api.get('/api/v1/admin/orders').set('Authorization', user.token).expect(403);
        const stay = { roomId: String(room._id),
            checkInDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
            checkOutDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
            peopleNum: 2, userInfo: { name: profile.name, email: profile.email, phone: profile.phone, address: profile.address } };
        const booking = (await api.post('/api/v1/orders').set('Authorization', user.token).send(stay).expect(200)).body;
        const id = booking.result._id;
        assert.equal((await Order.findById(id))?.peopleNum, 2);
        const order = await api.get(`/api/v1/orders/${id}`).set('Authorization', user.token).expect(200);
        assert.equal(order.body.result.roomId._id, String(room._id));
        await api.delete(`/api/v1/orders/${id}`).set('Authorization', user.token).expect(200);
        assert.equal((await Order.findById(id))?.status, -1);
    } finally {
        if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
        await mongoose.disconnect();
        await db.stop();
    }
});
