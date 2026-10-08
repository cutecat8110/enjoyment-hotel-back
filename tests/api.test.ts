import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app/createApp';
import User from '../src/models/user';
import Room from '../src/models/room';
import Order from '../src/models/order';
import { generateEmailToken } from '../src/utils';

process.env.JWT_SECRET = 'isolated-qa-only-not-a-deployment-secret';
process.env.JWT_EXPIRES_DAY = '1d';
const app = createApp();
let db: MongoMemoryServer;
let a: any, b: any, room: any;
const password = 'ExampleQA2026';
const profile = (email: string) => ({
    name: 'QA 測試',
    email,
    password,
    phone: '0912345678',
    birthday: '1990-02-28',
    address: { zipcode: 100, detail: '測試地址 1 號' }
});
const future = (offset: number) =>
    new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const booking = () => ({
    roomId: String(room._id),
    checkInDate: future(5),
    checkOutDate: future(7),
    peopleNum: 2,
    userInfo: { ...profile(a.result.email), password: undefined, birthday: undefined }
});
const auth = (token: string) => ({ Authorization: token });
before(async () => {
    db = await MongoMemoryServer.create({
        binary: {
            version: '7.0.24',
            ...(process.env.MONGOMS_SYSTEM_BINARY
                ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY }
                : {})
        }
    });
    await mongoose.connect(db.getUri());
    a = (
        await request(app).post('/api/v1/user/signup').send(profile('qa-a@example.com')).expect(200)
    ).body;
    b = (
        await request(app)
            .post('/api/v1/user/signup')
            .send({ ...profile('qa-b@example.com'), role: 'admin' })
            .expect(200)
    ).body;
    room = await Room.create({
        name: 'QA 房型',
        description: '測試',
        imageUrl: 'https://example.com/room.jpg',
        areaInfo: '10坪',
        bedInfo: '雙人床',
        maxPeople: 2,
        price: 3000
    });
});
after(async () => {
    await mongoose.disconnect();
    await db?.stop();
});
test('signup/login keep success contract and omit secrets', async () => {
    assert.equal(a.status, true);
    assert.equal(a.result.password, undefined);
    assert.equal(a.result.verificationToken, undefined);
    await request(app).post('/api/v1/user/signup').send(profile('qa-a@example.com')).expect(400);
    await request(app)
        .post('/api/v1/user/login')
        .send({ email: a.result.email, password })
        .expect(200);
    await request(app)
        .post('/api/v1/user/login')
        .send({ email: a.result.email, password: 'WrongQA2026' })
        .expect(400);
});
test('missing, invalid, expired and removed-user sessions return 401', async () => {
    const tokens = [
        '',
        'invalid',
        jwt.sign({ userId: a.result._id }, process.env.JWT_SECRET, { expiresIn: -1 }),
        jwt.sign({ userId: new mongoose.Types.ObjectId() }, process.env.JWT_SECRET)
    ];
    for (const token of tokens)
        await request(app).get('/api/v1/user/check').set(auth(token)).expect(401);
    await request(app).get('/api/v1/user/check').set(auth(a.token)).expect(200);
});
test('members cannot edit another profile or access admin routes', async () => {
    await request(app)
        .put('/api/v1/user')
        .set(auth(a.token))
        .send({ userId: b.result._id, name: '越權測試' })
        .expect(403);
    assert.equal((await User.findById(b.result._id))?.name, 'QA 測試');
    await request(app).get('/api/v1/admin/orders').set(auth(b.token)).expect(403);
    await User.updateOne({ _id: b.result._id }, { $set: { role: 'admin' } });
    await request(app).get('/api/v1/admin/orders').set(auth(b.token)).expect(200);
    await User.updateOne({ _id: b.result._id }, { $unset: { role: 1 } });
    await request(app).get('/api/v1/admin/orders').set(auth(b.token)).expect(403);
});
test('invalid profile cannot partially change password; valid changes persist', async () => {
    await request(app)
        .put('/api/v1/user')
        .set(auth(a.token))
        .send({
            userId: a.result._id,
            oldPassword: password,
            newPassword: 'ChangedQA2026',
            address: { zipcode: 99999, detail: '測試' }
        })
        .expect(400);
    await request(app)
        .post('/api/v1/user/login')
        .send({ email: a.result.email, password })
        .expect(200);
    const r = await request(app)
        .put('/api/v1/user')
        .set(auth(a.token))
        .send({ userId: a.result._id, name: 'QA 更新' })
        .expect(200);
    assert.equal(r.body.result.name, 'QA 更新');
    assert.equal(r.body.result.password, undefined);
});
test('orders reject zero-night, reversed, past, invalid dates and invalid people', async () => {
    for (const patch of [
        { checkOutDate: future(5) },
        { checkOutDate: future(4) },
        { checkInDate: future(-2), checkOutDate: future(-1) },
        { checkInDate: '2027-02-30' },
        { peopleNum: 0 },
        { peopleNum: 1.5 },
        { peopleNum: 3 },
        { peopleNum: '2' },
        { roomId: 'invalid' }
    ]) {
        await request(app)
            .post('/api/v1/orders')
            .set(auth(a.token))
            .send({ ...booking(), ...patch })
            .expect(400);
    }
});
test('order ownership, persistence and cancellation', async () => {
    const r = await request(app)
        .post('/api/v1/orders')
        .set(auth(a.token))
        .send(booking())
        .expect(200);
    const id = r.body.result._id;
    await request(app).get(`/api/v1/orders/${id}`).set(auth(b.token)).expect(404);
    await request(app).delete(`/api/v1/orders/${id}`).set(auth(b.token)).expect(404);
    const own = await request(app).get(`/api/v1/orders/${id}`).set(auth(a.token)).expect(200);
    assert.equal(own.body.result.roomId._id, String(room._id));
    assert.equal((await Order.findById(id))?.peopleNum, 2);
    await request(app).delete(`/api/v1/orders/${id}`).set(auth(a.token)).expect(200);
    await request(app).delete(`/api/v1/orders/${id}`).set(auth(a.token)).expect(200);
    assert.equal((await Order.findById(id))?.status, -1);
    await request(app).get('/api/v1/orders/invalid').set(auth(a.token)).expect(400);
});
test('reset code is single use (no email is sent)', async () => {
    const { code, token } = generateEmailToken();
    await User.updateOne({ _id: b.result._id }, { verificationToken: token });
    await request(app)
        .post('/api/v1/user/forgot')
        .send({ email: b.result.email, code, newPassword: 'ResetQA2026' })
        .expect(200);
    await request(app)
        .post('/api/v1/user/forgot')
        .send({ email: b.result.email, code, newPassword: 'ReusedQA2026' })
        .expect(400);
    await request(app)
        .post('/api/v1/user/login')
        .send({ email: b.result.email, password: 'ResetQA2026' })
        .expect(200);
});
test('invalid email returns a validation response, not a missing route', async () => {
    const r = await request(app)
        .post('/api/v1/verify/email')
        .send({ email: 'not-an-email' })
        .expect(400);
    assert.equal(r.body.message, 'Email 格式不正確');
});
test('password changes require both fields and persist after valid validation', async () => {
    await request(app)
        .put('/api/v1/user')
        .set(auth(a.token))
        .send({ oldPassword: password })
        .expect(400);
    await request(app)
        .put('/api/v1/user')
        .set(auth(a.token))
        .send({ oldPassword: 'WrongQA2026', newPassword: 'ChangedQA2026' })
        .expect(400);
    await request(app)
        .put('/api/v1/user')
        .set(auth(a.token))
        .send({ oldPassword: password, newPassword: 'ChangedQA2026' })
        .expect(200);
    await request(app)
        .post('/api/v1/user/login')
        .send({ email: a.result.email, password: 'ChangedQA2026' })
        .expect(200);
    await request(app)
        .post('/api/v1/user/login')
        .send({ email: a.result.email, password })
        .expect(400);
});
test('unavailable email service reports failure without sending mail', async () => {
    process.env.EMAILER_USER = '';
    process.env.EMAILER_PASSWORD = '';
    await request(app)
        .post('/api/v1/verify/generateEmailCode')
        .send({ email: a.result.email })
        .expect(503);
});
test('mail delivery failure keeps existing code; successful mocked delivery stores new code', async () => {
    const nodemailer = (await import('nodemailer')).default;
    const original = nodemailer.createTransport;
    process.env.EMAILER_USER = 'qa-sender@example.com';
    process.env.EMAILER_PASSWORD = 'isolated-fake-setting';
    const previous = generateEmailToken().token;
    await User.updateOne({ _id: a.result._id }, { verificationToken: previous });
    try {
        nodemailer.createTransport = (() => ({
            verify: async () => {
                throw new Error('redundant SMTP verify must not run');
            },
            sendMail: async () => {
                throw new Error('offline');
            }
        })) as any;
        await request(app)
            .post('/api/v1/verify/generateEmailCode')
            .send({ email: a.result.email })
            .expect(503);
        assert.equal(
            (await User.findById(a.result._id).select('+verificationToken'))?.verificationToken,
            previous
        );
        let message: any;
        nodemailer.createTransport = (() => ({
            verify: async () => { throw new Error('redundant SMTP verify must not run'); },
            sendMail: async (value: any) => {
                message = value;
                return { accepted: [value.to] };
            }
        })) as any;
        await request(app)
            .post('/api/v1/verify/generateEmailCode')
            .send({ email: a.result.email })
            .expect(200);
        assert.equal(message.to, a.result.email);
        const saved = await User.findById(a.result._id).select('+verificationToken');
        assert.ok(saved?.verificationToken);
        assert.notEqual(saved?.verificationToken, previous);
    } finally {
        nodemailer.createTransport = original;
        process.env.EMAILER_USER = '';
        process.env.EMAILER_PASSWORD = '';
    }
});

// Query-plan regression: large unrelated fixtures must not be scanned for one member.
test('member email and order-owner lookups use selective non-unique indexes', async (t) => {
    await Promise.all([User.init(), Order.init()]);
    await User.collection.insertMany(Array.from({ length: 1000 }, (_, i) => ({
        email: `index-qa-${i}@example.com`
    })));
    await Order.collection.insertMany(Array.from({ length: 1000 }, () => ({
        orderUserId: new mongoose.Types.ObjectId()
    })));
    const userQuery = { email: 'index-qa-999@example.com' };
    const userPlan = await User.findOne(userQuery).explain('executionStats');
    const scan = await User.findOne(userQuery).hint({ $natural: 1 }).explain('executionStats');
    t.diagnostic(`Email documents examined: scan=${scan.executionStats.totalDocsExamined}, index=${userPlan.executionStats.totalDocsExamined}`);
    const orderPlan = await Order.find({ orderUserId: a.result._id }).explain('executionStats');
    const orderScan = await Order.find({ orderUserId: a.result._id }).hint({ $natural: 1 }).explain('executionStats');
    t.diagnostic(`Order documents examined: scan=${orderScan.executionStats.totalDocsExamined}, index=${orderPlan.executionStats.totalDocsExamined}`);
    for (const plan of [userPlan, orderPlan]) {
        assert.match(JSON.stringify(plan.queryPlanner.winningPlan), /IXSCAN/);
        assert.ok(plan.executionStats.totalDocsExamined <= 2);
    }
    // Indexes intentionally allow old duplicates; no data migration or uniqueness change.
    await User.collection.insertOne({ email: a.result.email });
    await User.collection.deleteMany({ name: { $exists: false } });
    await Order.collection.deleteMany({ roomId: { $exists: false } });
});
test('email verification rejects missing and non-string email before querying', async () => {
    for (const email of [undefined, null, {}, [], 42]) {
        for (const endpoint of ['email', 'generateEmailCode']) {
            const response = await request(app).post(`/api/v1/verify/${endpoint}`)
                .send({ email }).expect(400);
            assert.match(response.body.message, /Email|欄位/);
        }
    }
});
test('address convention and room fields remain project-specific', async () => {
    // Team contract defines county as municipality and city as district.
    assert.equal(a.result.address.city, '中正區');
    assert.equal(a.result.address.county, '臺北市');
    const response = await request(app).get(`/api/v1/rooms/${room._id}`).expect(200);
    assert.equal(response.body.result.layoutInfo, undefined);
    assert.deepEqual(response.body.result.facilityInfo, []);
    assert.deepEqual(response.body.result.amenityInfo, []);
});
test('disconnected database returns 503 immediately and recovers after reconnect', async () => {
    await request(app).get('/').expect(200);
    const countBefore = await Order.countDocuments();
    await mongoose.disconnect();
    try {
        const start = Date.now();
        const response = await request(app).get('/').expect(503);
        assert.equal(response.headers['cache-control'], 'no-store');
        assert.equal(response.body.status, false);
        await request(app).get('/api/v1/rooms').expect(503);
        await request(app).post('/api/v1/orders').set(auth(a.token)).send(booking()).expect(503);
        assert.ok(Date.now() - start < 2000);
    } finally {
        await mongoose.connect(db.getUri());
    }
    await request(app).get('/').expect(200);
    await request(app).get('/api/v1/rooms').expect(200);
    assert.equal(await Order.countDocuments(), countBefore);
});

test('driver failure after readiness check returns retryable 503 without internal details', async (t) => {
    const mock = t.mock.method(Room, 'find', () => {
        throw Object.assign(new Error('internal-db-host-and-private-setting'), { name: 'MongoNetworkError' });
    });
    try {
        const response = await request(app).get('/api/v1/rooms').expect(503);
        assert.equal(response.body.status, false);
        assert.match(response.body.message, /稍後再試/);
        assert.doesNotMatch(JSON.stringify(response.body), /internal-db|private-setting/);
    } finally {
        mock.mock.restore();
    }
});
