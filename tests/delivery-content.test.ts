import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ClientRequest } from 'node:http';
import { verifyVideoContent, VIDEO_CONTENT_MAX_BYTES, VIDEO_CONTENT_TIMEOUT_MS, type DeliveryIO } from '../src/server/jobs/delivery';
const mp4=Buffer.concat([Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109]),Buffer.alloc(1024,42)]);
const webm=Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3]),Buffer.alloc(64,21)]);
type Response=PassThrough & {statusCode:number;headers:Record<string,string|string[]>;rawHeaders:string[];complete:boolean;aborted:boolean};
type Request=EventEmitter & {end():void;destroy():void};
type Fixture={
 addresses?:{address:string;family:number}[];resolve?:DeliveryIO['resolve'];
 status?:number;headers?:Record<string,string|string[]>;rawHeaders?:string[];
 chunks?:Buffer[];complete?:boolean;
 drive?:(res:Response,req:Request)=>void;
 beforeResponse?:(req:Request)=>boolean;
};
function transport(options:Fixture={}) {
 let requests=0,destroyed=false,dnsCalls=0,response:Response|undefined;
 const pinnedLookups:unknown[]=[];
 const io:DeliveryIO={
  resolve:async host=>{dnsCalls++;assert.equal(host,'video.example');return options.resolve?options.resolve(host):options.addresses??[{address:'8.8.8.8',family:4}];},
  request:((url:URL,init:Record<string,unknown>,respond:(res:IncomingMessage)=>void)=>{
   requests++;
   assert.equal(url.protocol,'https:');assert.equal(init.agent,false);assert.equal(init.rejectUnauthorized,true);
   assert.deepEqual(init.headers,{Accept:'video/mp4,video/webm,video/quicktime','Accept-Encoding':'identity'});
   const lookup=init.lookup as (...args:unknown[])=>void;
   lookup(url.hostname,{all:true},(error:unknown,addresses:unknown)=>{assert.equal(error,null);pinnedLookups.push(addresses);});
   lookup(url.hostname,{},(error:unknown,address:unknown,family:unknown)=>{assert.equal(error,null);pinnedLookups.push({address,family});});
   const req=new EventEmitter() as Request;
   req.destroy=()=>{destroyed=true;response?.destroy();req.emit('close');};
   req.end=()=>{
    if(options.beforeResponse?.(req)===false) return;
    const res=new PassThrough() as Response;response=res;
    res.statusCode=options.status??200;res.headers={'content-type':'video/mp4',...options.headers};res.rawHeaders=options.rawHeaders??[];
    res.complete=false;res.aborted=false;
    res.on('close',()=>req.emit('close'));
    respond(res as unknown as IncomingMessage);
    if(res.destroyed) return;
    if(options.drive) {options.drive(res,req);return;}
    for(const chunk of options.chunks??[mp4]) {if(res.destroyed) return;res.write(chunk);}
    if(res.destroyed) return;
    res.complete=options.complete??true;res.end();
   };
   return req as unknown as ClientRequest;
  }) as never,
 };
 return {io,requests:()=>requests,destroyed:()=>destroyed,dnsCalls:()=>dnsCalls,pinnedLookups};
}
const url='https://video.example/output.mp4';
const sha=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
test('full content hash includes every byte with content length, split header and pinned TLS lookup',async()=>{
 const t=transport({headers:{'content-length':String(mp4.length)},chunks:[mp4.subarray(0,3),mp4.subarray(3,9),mp4.subarray(9,32),mp4.subarray(32)]});
 assert.deepEqual(await verifyVideoContent(url,t.io),{contentSha256:sha(mp4),bytes:mp4.length,mime:'video/mp4'});
 assert.equal(t.requests(),1);assert.equal(t.dnsCalls(),1);
 assert.deepEqual(t.pinnedLookups,[[{address:'8.8.8.8',family:4}],{address:'8.8.8.8',family:4}]);
});
test('full body with chunked framing or no content length succeeds only on complete end',async()=>{
 for(const headers of [{'transfer-encoding':'chunked'},{}] as Array<Record<string,string>>)  {
  const t=transport({headers:{...headers,'content-type':'video/webm'},chunks:[webm.subarray(0,2),webm.subarray(2)]});
  assert.deepEqual(await verifyVideoContent(url,t.io),{contentSha256:sha(webm),bytes:webm.length,mime:'video/webm'});
 }
});
test('QuickTime MIME parameters accepted with valid complete ftyp body',async()=>{
 const t=transport({headers:{'content-type':'Video/QuickTime; charset=binary'}});
 assert.equal((await verifyVideoContent(url,t.io))?.mime,'video/quicktime');
});
test('hostile URLs and literal addresses rejected before resolution or request',async()=>{
 for(const value of ['http://video.example/a','https://u:p@video.example/a','https://video.example:8443/a','https://127.1/a','https://2130706433/a','https://10.1.2.3/a','https://[::1]/a','https://[::ffff:127.0.0.1]/a','https://169.254.169.254/a','https://video.example/a#fragment']) {
  const t=transport();assert.equal(await verifyVideoContent(value,t.io),null,value);assert.equal(t.requests(),0);assert.equal(t.dnsCalls(),0);
 }
});
test('mixed public/private DNS, invalid families, reserved and mapped addresses fail closed',async()=>{
 for(const addresses of [[],[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}],[{address:'8.8.8.8',family:6}],[{address:'192.168.1.1',family:4}],[{address:'100.64.0.1',family:4}],[{address:'192.0.2.1',family:4}],[{address:'::ffff:8.8.8.8',family:6}],[{address:'2001:db8::1',family:6}],[{address:'2002:7f00:1::',family:6}]]) {
  const t=transport({addresses});assert.equal(await verifyVideoContent(url,t.io),null);assert.equal(t.requests(),0);
 }
});
test('public IP literals cannot be rewritten by a resolver; public IPv6 DNS is pinned',async()=>{
 const literal=transport({resolve:async()=>{throw new Error('IP literal must not resolve');}});
 assert.ok(await verifyVideoContent('https://8.8.8.8/video.mp4',literal.io));assert.equal(literal.dnsCalls(),0);
 const t=transport({addresses:[{address:'2606:4700:4700::1111',family:6}]});
 assert.ok(await verifyVideoContent(url,t.io));assert.deepEqual(t.pinnedLookups[1],{address:'2606:4700:4700::1111',family:6});
});
test('redirects, ranges, HTML, encodings and ambiguous framing never yield a hash',async()=>{
 const fixtures:Fixture[]=[
  {status:302,headers:{location:'https://127.0.0.1/private'}},{status:206},{status:204},
  {headers:{'content-range':`bytes 0-${mp4.length-1}/${mp4.length}`}},
  {headers:{'content-type':'text/html'}},{headers:{'content-type':['video/mp4','text/html']}},
  {headers:{'content-encoding':'gzip'}},{headers:{'transfer-encoding':'gzip, chunked'}},
  {headers:{'transfer-encoding':'chunked','content-length':String(mp4.length)}},
  {headers:{'content-length':String(mp4.length)},rawHeaders:['Content-Length',String(mp4.length),'Content-Length',String(mp4.length)]},
  {headers:{'content-length':'1, 2'}},{headers:{'content-length':'-1'}},{headers:{'content-length':'1.5'}},{headers:{'content-length':'0'}},
 ];
 for(const fixture of fixtures) {
  const t=transport(fixture);assert.equal(await verifyVideoContent(url,t.io),null,JSON.stringify(fixture));assert.equal(t.requests(),1);assert.equal(t.destroyed(),true);
 }
});
test('declared length, parser completeness, empty and invalid video bytes are mandatory',async()=>{
 for(const fixture of [
  {headers:{'content-length':String(mp4.length+1)}},{headers:{'content-length':String(mp4.length-1)}},
  {complete:false},{chunks:[]},{chunks:[Buffer.from('<html>not a movie</html>')]},
  {chunks:[Buffer.from([0,0,1,0,102,116,121,112,105,115,111,109])]},
 ]) {
  const t=transport(fixture);assert.equal(await verifyVideoContent(url,t.io),null);assert.equal(t.destroyed(),true);
 }
});
test('aborted, errored, prematurely closed response and request error/close reject partial content',async()=>{
 const drives:Fixture['drive'][]=[
  res=>{res.write(mp4.subarray(0,64));res.aborted=true;res.emit('aborted');},
  res=>{res.write(mp4.subarray(0,64));res.emit('error',new Error('synthetic stream error'));},
  res=>{res.write(mp4.subarray(0,64));res.destroy();},
  (res,req)=>{res.write(mp4.subarray(0,64));req.emit('close');},
 ];
 for(const drive of drives) {const t=transport({drive});assert.equal(await verifyVideoContent(url,t.io),null);assert.equal(t.destroyed(),true);}
 for(const event of ['error','close']) {
  const t=transport({beforeResponse:req=>{req.emit(event,new Error('synthetic request error'));return false;}});
  assert.equal(await verifyVideoContent(url,t.io),null);
 }
});
test('byte ceiling rejects oversized headers before data and streaming overflow without a length',async()=>{
 const early=transport({headers:{'content-length':String(VIDEO_CONTENT_MAX_BYTES+1)}});
 assert.equal(await verifyVideoContent(url,early.io),null);assert.equal(early.destroyed(),true);
 const full=transport({chunks:[mp4.subarray(0,64),mp4.subarray(64)]});
 assert.equal(await verifyVideoContent(url,full.io,{maxBytes:128}),null);assert.equal(full.destroyed(),true);
 const exact=transport({chunks:[mp4]});assert.ok(await verifyVideoContent(url,exact.io,{maxBytes:mp4.length}));
});
test('ceiling overrides can only tighten configured byte and timeout bounds',async()=>{
 for(const limits of [{maxBytes:VIDEO_CONTENT_MAX_BYTES+1},{timeoutMs:VIDEO_CONTENT_TIMEOUT_MS+1},{maxBytes:NaN},{maxBytes:1.5},{maxBytes:0},{timeoutMs:0}]) {
  const t=transport();assert.equal(await verifyVideoContent(url,t.io,limits),null);assert.equal(t.requests(),0);
 }
});
test('DNS rejection or timeout never opens an HTTP request',async()=>{
 for(const resolve of [async()=>{throw new Error('synthetic DNS error');},()=>new Promise<never>(()=>{})]) {
  const t=transport({resolve});assert.equal(await verifyVideoContent(url,t.io,{timeoutMs:20}),null);assert.equal(t.requests(),0);
 }
});
test('absolute timeout cancels a stalled or trickling stream; data cannot renew the deadline',async()=>{
 for(const trickle of [false,true]) {
  let ticks=0;
  const t=transport({drive:res=>{
   if(trickle) {
    res.write(mp4.subarray(0,32));
    const timer=setInterval(()=>{ticks++;res.write(Buffer.alloc(2));},2);
    res.once('close',()=>clearInterval(timer));
   }
  }});
  const start=performance.now();assert.equal(await verifyVideoContent(url,t.io,{timeoutMs:25}),null);
  assert.ok(performance.now()-start<1000);assert.equal(t.destroyed(),true);if(trickle) assert.ok(ticks>0);
 }
});
test('streaming many chunks hashes exact full content without retaining the body',async()=>{
 const hash=createHash('sha256');hash.update(mp4);
 const chunk=Buffer.alloc(4096,7);for(let i=0;i<2048;i++)hash.update(chunk);
 let produced=0;
 const t=transport({drive:res=>{
  res.write(mp4);
  for(let i=0;i<2048 && !res.destroyed;i++) {res.write(chunk);produced++;}
  res.complete=true;res.end();
 }});
 assert.deepEqual(await verifyVideoContent(url,t.io),{contentSha256:hash.digest('hex'),bytes:mp4.length+2048*4096,mime:'video/mp4'});
 assert.equal(produced,2048);
});

test('normal end after absolute deadline cannot be accepted even if timer callbacks were delayed',async()=>{
 const t=transport({drive:res=>{
  res.write(mp4);
  const until=performance.now()+20;
  while(performance.now()<until) { /* Simulate an occupied event loop, not network delay. */ }
  res.complete=true;res.end();
 }});
 assert.equal(await verifyVideoContent(url,t.io,{timeoutMs:10}),null);
});
test('parser complete flag without normal end still times out',async()=>{
 const t=transport({drive:res=>{res.write(mp4);res.complete=true;}});
 assert.equal(await verifyVideoContent(url,t.io,{timeoutMs:15}),null);assert.equal(t.destroyed(),true);
});
