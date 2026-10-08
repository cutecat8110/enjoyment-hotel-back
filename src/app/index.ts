import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDatabase } from '@/app/connection';
import { createApp } from '@/app/createApp';
import { catchGlobalError } from '@/app/exception';

catchGlobalError();

try {
    await connectDatabase();
    console.log('[ mongodb 連線成功 ]');
    const app = createApp({ logging: true });
    app.listen(process.env.PORT, () => {
        console.log(`listening on http://localhost:${process.env.PORT}`);
    });
} catch {
    // Driver errors can contain hosts or credentials; keep deployment logs generic.
    console.error('[ mongodb 連線失敗，服務未啟動 ]');
    await mongoose.disconnect();
    process.exitCode = 1;
}
