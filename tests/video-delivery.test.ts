import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { verifyVideoDelivery, type DeliveryIO } from '../src/server/jobs/delivery';
function transport(options:{mime?:string;status?:number;body?:Buffer;address?:string}={}) {
 let requests=0;
 const io:DeliveryIO={resolve:async()=>[{address:options.address??'8.8.8.8',family:4}],request:((url:URL,init:Record<string,unknown>,respond:(r:unknown)=>void)=>{
  requests++;
  assert.equal(url.protocol,'https:');assert.deepEqual(init.headers,{Range:'bytes=0-4095',Accept:'video/mp4,video/webm,video/quicktime'});
  const lookup=init.lookup as (...args:unknown[])=>void;
  lookup('delivery.example',{all:true},(error:unknown,addresses:unknown)=>{assert.equal(error,null);assert.deepEqual(addresses,[{address:'8.8.8.8',family:4}]);});
  lookup('delivery.example',{},(error:unknown,address:unknown,family:unknown)=>{assert.equal(error,null);assert.equal(address,'8.8.8.8');assert.equal(family,4);});
  const req=new EventEmitter() as EventEmitter & {end:()=>void;destroy:()=>void};
  req.destroy=()=>{req.emit('close');};
  req.end=()=>{
   const body=options.body??Buffer.concat([Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109]),Buffer.alloc(100_000)]);
   const res=Readable.from([body]) as Readable & {statusCode:number;headers:Record<string,string>};
   res.statusCode=options.status??206;res.headers={'content-type':options.mime??'video/mp4'};
   res.on('close',()=>req.emit('close'));respond(res);
  };
  return req;
 }) as never};
 return {io,requests:()=>requests};
}
test('delivery uses pinned public address, bounded ranged GET and verifies video bytes',async()=>{
 const t=transport();assert.equal(await verifyVideoDelivery('https://delivery.example/output.mp4',t.io),true);assert.equal(t.requests(),1);
});
test('delivery rejects private DNS, redirects, forbidden port, HTML and MIME-only pretend videos',async()=>{
 for(const o of [{address:'127.0.0.1'},{status:302},{mime:'text/html'},{body:Buffer.from('<html>not a real generated video</html>')}]) {
  const t=transport(o);assert.equal(await verifyVideoDelivery('https://delivery.example/output.mp4',t.io),false);
  if(o.address) assert.equal(t.requests(),0);
 }
 const t=transport();assert.equal(await verifyVideoDelivery('https://delivery.example:8443/output.mp4',t.io),false);assert.equal(t.requests(),0);
});
