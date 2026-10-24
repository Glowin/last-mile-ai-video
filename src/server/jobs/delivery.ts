import { createHash } from "node:crypto";
import type { ClientRequest, IncomingMessage } from "node:http";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";
/** DNS results are checked then pinned to the TLS connection to prevent rebinding. */
export function publicAddress(address: string): boolean {
  if(isIP(address)===4) {
    const [a,b]=address.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || a===169&&b===254 || a===172&&b>=16&&b<=31 || a===192&&(b===168||b===0||b===2) || a===100&&b>=64&&b<=127 || a===198&&(b===18||b===19||b===51) || a===203&&b===0);
  }
  // Only global unicast; excludes mapped IPv4, loopback, link-local and ULA.
  return isIP(address)===6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:(?:db8|0|10|20):/i.test(address) && !/^2002:/i.test(address);
}
export function videoHeader(mime: string, data: Uint8Array) {
  const b=Buffer.from(data), type=mime.split(';')[0].trim().toLowerCase();
  if(type==='video/mp4' || type==='video/quicktime') return b.length>=12 && b.toString('ascii',4,8)==='ftyp' && b.readUInt32BE(0)>=12;
  return type==='video/webm' && b.length>=4 && b.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
}
/** Small authenticated-free GET; no redirects, arbitrary ports, cookies, or entire-video buffering. */
export type DeliveryIO = {
  resolve: (host: string) => Promise<{address:string;family:number}[]>;
  request: typeof request;
};
const realIO: DeliveryIO={resolve:host=>lookup(host,{all:true}),request};
export async function verifyVideoDelivery(value:string,io:DeliveryIO=realIO):Promise<boolean> {
  try {
    const u=new URL(value);
    if(u.protocol!=='https:' || u.username || u.password || u.port && u.port!=='443') return false;
    const host=u.hostname.replace(/^\[|\]$/g,'');
    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    const addresses=await Promise.race([
      io.resolve(host),
      new Promise<never>((_resolve,reject)=>{dnsTimer=setTimeout(()=>reject(new Error("DNS timeout")),3_000);}),
    ]).finally(()=>clearTimeout(dnsTimer));
    if(!addresses.length || addresses.some(a=>!publicAddress(a.address))) return false;
    const pinned=addresses[0];
    return await new Promise<boolean>(resolve=>{
      let done=false;
      const finish=(ok:boolean)=>{ if(!done){done=true;resolve(ok);} };
      const req=io.request(u,{method:'GET',headers:{Range:'bytes=0-4095',Accept:'video/mp4,video/webm,video/quicktime'},lookup:((_h:unknown,options:{all?:boolean},cb:(...args:unknown[])=>void)=>options.all ? cb(null,[pinned]) : cb(null,pinned.address,pinned.family)) as never},res=>{
        if(![200,206].includes(res.statusCode??0)){res.destroy();finish(false);return;}
        let data=Buffer.alloc(0);
        res.on('data',(chunk:Buffer)=>{
          data=Buffer.concat([data,chunk.subarray(0,4096-data.length)]);
          if(data.length>=32){finish(videoHeader(String(res.headers['content-type']??''),data));res.destroy();}
        });
        res.on('end',()=>finish(videoHeader(String(res.headers['content-type']??''),data)));
        res.on('error',()=>finish(false));
        res.on('aborted',()=>finish(false));
      });
      const timer=setTimeout(()=>{req.destroy();finish(false);},10_000);
      req.on('close',()=>clearTimeout(timer));
      req.on('error',()=>finish(false));
      req.end();
    });
  } catch {return false;}
}

export type VerifiedVideoContent = {
  /** SHA-256 of the entire, unencoded response body, not a URL or prefix. */
  contentSha256: string;
  bytes: number;
  mime: 'video/mp4' | 'video/quicktime' | 'video/webm';
};
export const VIDEO_CONTENT_MAX_BYTES = 128 * 1024 * 1024;
export const VIDEO_CONTENT_TIMEOUT_MS = 30_000;
export type VideoContentLimits = { maxBytes?: number; timeoutMs?: number };
/** Full, streaming transport verification for moderation evidence. No disk writes,
 * redirects, cookies, Range requests or whole-file buffering. Limits can only be
 * reduced from the hard ceilings. Null means no complete verified artifact.
 * This verifies HTTP completeness and MIME/signature, not codec decodability,
 * duration or policy compliance; human review must use the same content hash. */
export async function verifyVideoContent(
  value: string,
  io: DeliveryIO = realIO,
  limits: VideoContentLimits = {},
): Promise<VerifiedVideoContent | null> {
  const maxBytes=limits.maxBytes ?? VIDEO_CONTENT_MAX_BYTES;
  const timeoutMs=limits.timeoutMs ?? VIDEO_CONTENT_TIMEOUT_MS;
  if(!Number.isSafeInteger(maxBytes) || maxBytes<12 || maxBytes>VIDEO_CONTENT_MAX_BYTES ||
     !Number.isSafeInteger(timeoutMs) || timeoutMs<1 || timeoutMs>VIDEO_CONTENT_TIMEOUT_MS) return null;
  const deadline=performance.now()+timeoutMs;
  try {
    const u=new URL(value);
    if(u.protocol!=='https:' || u.username || u.password || u.port && u.port!=='443' || u.hash) return null;
    const host=u.hostname.replace(/^\[|\]$/g,'');
    const literalFamily=isIP(host);
    // HTTPS bypasses custom lookup for IP literals: validate the literal itself.
    if(literalFamily && !publicAddress(host)) return null;
    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    const addresses=literalFamily ? [{address:host,family:literalFamily}] : await Promise.race([
      io.resolve(host),
      new Promise<never>((_resolve,reject)=>{dnsTimer=setTimeout(()=>reject(new Error('DNS timeout')),Math.min(3_000,timeoutMs));}),
    ]).finally(()=>clearTimeout(dnsTimer));
    if(!addresses.length || addresses.some(a=>!publicAddress(a.address) || isIP(a.address)!==a.family)) return null;
    const pinned=addresses[0];
    const remaining=deadline-performance.now();
    if(remaining<=0) return null;
    return await new Promise<VerifiedVideoContent|null>(resolve=>{
      let done=false, ended=false, req:ClientRequest|undefined, response:IncomingMessage|undefined;
      let timer:ReturnType<typeof setTimeout>|undefined;
      const finish=(result:VerifiedVideoContent|null)=>{
        if(done) return;
        done=true;clearTimeout(timer);
        // Set done before destroy: abort/close handlers may run synchronously.
        if(result===null) {response?.destroy();req?.destroy();}
        resolve(result);
      };
      timer=setTimeout(()=>finish(null),remaining);
      try {
        req=io.request(u,{
          method:'GET',agent:false,rejectUnauthorized:true,
          headers:{Accept:'video/mp4,video/webm,video/quicktime','Accept-Encoding':'identity'},
          lookup:((_host:unknown,options:{all?:boolean},callback:(...args:unknown[])=>void)=>options.all
            ? callback(null,[pinned]) : callback(null,pinned.address,pinned.family)) as never,
        },res=>{
          response=res;
          // A late response after the timeout must not leak a readable socket.
          if(done) {res.destroy();return;}
          res.on('error',()=>finish(null));
          res.on('aborted',()=>finish(null));
          res.on('close',()=>{if(!ended) finish(null);});
          const contentType=res.headers['content-type'];
          const mime=typeof contentType==='string'?contentType.split(';')[0].trim().toLowerCase():'';
          const encoding=res.headers['content-encoding'];
          const length=res.headers['content-length'];
          const transfer=res.headers['transfer-encoding'];
          if(res.statusCode!==200 || res.headers['content-range']!==undefined ||
             !['video/mp4','video/quicktime','video/webm'].includes(mime) ||
             encoding!==undefined && encoding!=='identity' ||
             transfer!==undefined && transfer!=='chunked' ||
             length!==undefined && transfer!==undefined) {finish(null);return;}
          let expected:number|undefined;
          if(length!==undefined) {
            if(typeof length!=='string' || !/^[0-9]+$/.test(length)) {finish(null);return;}
            expected=Number(length);
            if(!Number.isSafeInteger(expected) || expected<1 || expected>maxBytes) {finish(null);return;}
          }
          // Node's real parser rejects duplicate Content-Length; also fail closed
          // for injected transports or unusual upstream framing of any kind.
          const framingCounts=new Map<string,number>();
          for(let i=0;i<(res.rawHeaders?.length??0);i+=2) {
            const name=res.rawHeaders[i].toLowerCase();
            if(['content-length','transfer-encoding','content-type','content-encoding','content-range'].includes(name)) framingCounts.set(name,(framingCounts.get(name)??0)+1);
          }
          if([...framingCounts.values()].some(n=>n>1)) {finish(null);return;}
          const hash=createHash('sha256');
          let bytes=0, prefix=Buffer.alloc(0);
          res.on('data',(chunk:Buffer)=>{
            if(done) return;
            if(performance.now()>=deadline || !Buffer.isBuffer(chunk) || chunk.length>maxBytes-bytes || expected!==undefined && chunk.length>expected-bytes) {finish(null);return;}
            bytes+=chunk.length;
            if(prefix.length<32) prefix=Buffer.concat([prefix,chunk.subarray(0,32-prefix.length)]);
            if(prefix.length>=12 && !videoHeader(mime,prefix)) {finish(null);return;}
            hash.update(chunk);
          });
          res.on('end',()=>{
            ended=true;
            if(done) return;
            // complete is Node's HTTP parser proof that the declared message
            // framing ended; a truncated body or missing final chunk fails it.
            if(performance.now()>=deadline || !res.complete || res.aborted || bytes===0 || expected!==undefined && bytes!==expected || !videoHeader(mime,prefix)) {finish(null);return;}
            if(mime!=='video/webm' && prefix.readUInt32BE(0)>bytes) {finish(null);return;}
            finish({contentSha256:hash.digest('hex'),bytes,mime:mime as VerifiedVideoContent['mime']});
          });
        });
        req.on('error',()=>finish(null));
        req.on('close',()=>{if(!ended) finish(null);});
        if(done) req.destroy();else req.end();
      } catch {finish(null);}
    });
  } catch {return null;}
}
