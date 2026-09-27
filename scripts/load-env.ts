// scripts/*.ts 用：OS の環境変数より .env.local を優先して読み込む
import { config } from 'dotenv';

config({ path: '.env.local', override: true, quiet: true });
