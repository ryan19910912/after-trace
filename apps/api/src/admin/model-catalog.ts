import catalog from '../../../../config/local-ai-models.seed.json';
export { catalog as localModelCatalog };
export function validModelId(value: unknown): value is string { return typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(value); }
export async function verifyModelRepository(id: string, kind: 'vision'|'speech'): Promise<{id:string;revision:string}> {
  if(!validModelId(id))throw new Error('MODEL_ID_INVALID');
  const timeout=AbortSignal.timeout(10000);
  const response=await fetch('https://huggingface.co/api/models/'+id+'?expand[]=sha&expand[]=siblings', {signal:timeout});
  if(!response.ok)throw new Error('MODEL_REPOSITORY_UNAVAILABLE');
  const text=await response.text();if(text.length>300000)throw new Error('MODEL_METADATA_TOO_LARGE');const metadata=JSON.parse(text);
  const configResponse=await fetch('https://huggingface.co/'+id+'/raw/'+metadata.sha+'/config.json',{signal:timeout});if(!configResponse.ok)throw new Error('MODEL_CONFIG_UNAVAILABLE');
  const configText=await configResponse.text();if(configText.length>100000)throw new Error('MODEL_CONFIG_INVALID');const config=JSON.parse(configText);
  const files=new Set((metadata.siblings??[]).map((f:{rfilename:string})=>f.rfilename));const required=kind==='vision'?['embed_tokens_q4','vision_encoder_fp16','decoder_model_merged_q4']:['encoder_model_q4','decoder_model_merged_q4'];
  if(kind==='vision'&&!String(config.model_type).includes('qwen3_5'))throw new Error('MODEL_ARCHITECTURE_UNSUPPORTED');
  if(kind==='speech'&&(config.model_type!=='whisper'||id.includes('.en')))throw new Error('MODEL_ARCHITECTURE_UNSUPPORTED');
  if(required.some(name=>!files.has('onnx/'+name+'.onnx'))||!/^[a-f0-9]{40}$/.test(metadata.sha))throw new Error('MODEL_FILES_INCOMPATIBLE');
  return {id,revision:metadata.sha};
}
