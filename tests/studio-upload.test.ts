import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StudioImageUpload } from '../src/components/studio';
import { ImageUploadError, type NormalizedImageUpload } from '../src/lib/image-upload';
const image=(dataUrl:string):NormalizedImageUpload=>({dataUrl,mimeType:'image/jpeg',width:768,height:768,bytes:100,originalBytes:200,optimized:true});
function deferred<T>() {let resolve!:(value:T)=>void, reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
test('later image selection wins; old completion cannot replace normalized preview or clear new busy state',async()=>{
  const a=deferred<NormalizedImageUpload>(),b=deferred<NormalizedImageUpload>();let calls=0;
  const upload=new StudioImageUpload(()=> (++calls===1?a:b).promise);
  const outputs:string[]=[],errors:string[]=[],busy:boolean[]=[];
  const first=upload.prepare(new Blob(),x=>outputs.push(x.dataUrl),x=>errors.push(x),x=>busy.push(x));
  const second=upload.prepare(new Blob(),x=>outputs.push(x.dataUrl),x=>errors.push(x),x=>busy.push(x));
  a.resolve(image('old'));await first;assert.equal(upload.pending,true);assert.equal(outputs.length,0);assert.deepEqual(busy,[true,true]);
  b.resolve(image('exact-normalized-data'));await second;
  assert.deepEqual(outputs,['exact-normalized-data']);assert.equal(errors.length,0);assert.equal(upload.pending,false);assert.deepEqual(busy,[true,true,false]);
});
test('old errors and canceled preparation cannot update UI; failure never supplies original bytes',async()=>{
  const a=deferred<NormalizedImageUpload>(),b=deferred<NormalizedImageUpload>();let calls=0;
  const upload=new StudioImageUpload(()=>(++calls===1?a:b).promise);
  const outputs:string[]=[],errors:string[]=[],busy:boolean[]=[];
  const run=()=>upload.prepare(new Blob(['large original']),x=>outputs.push(x.dataUrl),x=>errors.push(x),x=>busy.push(x));
  const first=run(),second=run();a.reject(new ImageUploadError('Old failure'));await first;assert.equal(errors.length,0);
  b.reject(new ImageUploadError('Choose a simpler image.'));await second;
  assert.deepEqual(errors,['Choose a simpler image.']);assert.equal(outputs.length,0);assert.equal(upload.pending,false);
  const late=deferred<NormalizedImageUpload>(),canceled=new StudioImageUpload(()=>late.promise);
  const pending=canceled.prepare(new Blob(),x=>outputs.push(x.dataUrl),x=>errors.push(x),x=>busy.push(x));
  const revision=canceled.revision;canceled.cancel();assert.ok(canceled.revision>revision);
  late.resolve(image('canceled'));await pending;assert.equal(outputs.length,0);assert.equal(canceled.pending,false);
});
