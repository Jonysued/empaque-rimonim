import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import path from 'node:path';
export default defineConfig({ plugins:[react()], build:{rolldownOptions:{input:{app:path.resolve(import.meta.dirname,'index.html'),commercial:path.resolve(import.meta.dirname,'commercial.html')}}}, resolve:{alias:{'@':path.resolve(import.meta.dirname,'src')}} });
