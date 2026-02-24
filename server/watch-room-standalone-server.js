#!/usr/bin/env node

// 独立的观影室服务器
// 使用方式: node watch-room-standalone-server.js --port 3001 --auth YOUR_SECRET_KEY

import { createServer } from 'http';
import { Server } from 'socket.io';
import { WatchRoomServer } from '../lib/watch-room-server';

const args = process.argv.slice(2);
const port = parseInt(args[args.indexOf('--port') + 1] || '3001');
const cliAuthIndex = args.indexOf('--auth');
const cliAuth = cliAuthIndex >= 0 ? args[cliAuthIndex + 1] : undefined;
const authKey = cliAuth || process.env.WATCH_ROOM_AUTH || '';

if (!authKey) {
  console.error('Error: --auth parameter is required or WATCH_ROOM_AUTH env var must be set');
  console.log('Usage: node watch-room-standalone-server.js --port 3001 --auth <secret>');
  console.log('Alternatively, set WATCH_ROOM_AUTH environment variable to provide the secret.');
  process.exit(1);
}

const httpServer = createServer();

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // 添加鉴权中间件
  allowRequest: (req, callback) => {
    const auth = req.headers.authorization;
    if (auth === `Bearer ${authKey}`) {
      callback(null, true);
    } else {
      console.log('[WatchRoom] Unauthorized connection attempt');
      callback('Unauthorized', false);
    }
  },
});

// 初始化观影室服务器
const watchRoomServer = new WatchRoomServer(io);

httpServer.listen(port, () => {
  console.log(`[WatchRoom] Standalone server running on port ${port} (${authKey ? 'auth enabled' : 'auth disabled'})`);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n[WatchRoom] Shutting down...');
  watchRoomServer.destroy();
  httpServer.close(() => {
    console.log('[WatchRoom] Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n[WatchRoom] Shutting down...');
  watchRoomServer.destroy();
  httpServer.close(() => {
    console.log('[WatchRoom] Server closed');
    process.exit(0);
  });
});
