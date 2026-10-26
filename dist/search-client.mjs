export async function readSearchStream(response,onEvent){
 if(!response.ok){let data;try{data=await response.json()}catch{}throw Error(data?.error||'查询失败 HTTP '+response.status)}
 if(!response.body)throw Error('查询服务未返回数据流');
 const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',doneEvent=false;
 const line=text=>{if(!text.trim())return;if(doneEvent)throw Error('查询结束后收到额外数据');const event=JSON.parse(text);onEvent(event);if(event.type==='done')doneEvent=true};
 try{
  while(true){const {value,done}=await reader.read();pending+=done?decoder.decode():decoder.decode(value,{stream:true});let newline;
   while((newline=pending.indexOf('\n'))>=0){line(pending.slice(0,newline));pending=pending.slice(newline+1)}
   if(done)break;
  }
  line(pending);if(!doneEvent)throw Error('连接提前结束，已保留收到的结果');
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
