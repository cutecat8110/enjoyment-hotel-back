import mongoose from 'mongoose';

// Called explicitly by the entry point so HTTP does not advertise readiness before MongoDB.
export async function connectDatabase() {
    const { DATABASE, DATABASE_PASSWORD } = process.env;
    if (!DATABASE) throw new Error('DATABASE 未設定');
    mongoose.set('strictQuery', false);
    await mongoose.connect(DATABASE.replace('<password>', DATABASE_PASSWORD || ''), {
        serverSelectionTimeoutMS: 30000,
        connectTimeoutMS: 10000
    });
}
