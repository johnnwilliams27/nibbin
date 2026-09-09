import { createServer } from 'node:http';
import handler from '../api/reviews.mjs';
const port=Number(process.env.PORT??3101);
createServer((req,res)=>{if(new URL(req.url,'http://localhost').pathname!=='/api/reviews'){res.writeHead(404).end();return;}return handler(req,res);}).listen(port,'127.0.0.1',()=>console.log(`Review API: http://localhost:${port}/api/reviews`));
