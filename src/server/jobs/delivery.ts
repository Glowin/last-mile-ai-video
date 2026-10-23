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
