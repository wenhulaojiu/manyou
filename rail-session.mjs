import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import PQueue from 'p-queue';
import {abortable, deadlineScope} from './async-utils.mjs';

// Each search owns its client. Cleanup from an old search cannot close a new client.
export function createRailSession({onStatus = () => {}, makeClient = () => new Client({name:'manyou',version:'1.1.0'}),
  makeTransport = () => new StdioClientTransport({command:process.execPath,
    args:[fileURLToPath(new URL('./node_modules/12306-mcp/build/index.js',import.meta.url))],
    stderr:'pipe', env:{...process.env,TZ:'Asia/Shanghai'}})} = {}) {
  const queue = new PQueue({concurrency:1});
  let connection, closed = false;
  async function retire(owned) {
    if (connection === owned) connection = undefined;
    if (!owned) return;
    owned.closing ??= Promise.resolve().then(() => owned.transport.close()).catch(() => {});
    await owned.closing;
  }
  async function call(name, args, {signal, deadline = Date.now()+20000} = {}) {
    return queue.add(async () => {
      if (closed) throw new Error('铁路查询已关闭');
      const scope = deadlineScope(signal, Math.min(35000,deadline-Date.now()));
      let owned;
      try {
        scope.signal.throwIfAborted();
        if (!connection) {
          const transport = makeTransport(), client = makeClient();
          transport.stderr?.on('data', () => {});
          owned = connection = {transport,client};
          onStatus('connecting','正在连接铁路查询');
          owned.ready = client.connect(transport);
        } else owned = connection;
        await abortable(() => owned.ready, scope.signal);
        const result = await abortable(() => owned.client.callTool({name,arguments:args},undefined,
          {signal:scope.signal,timeout:Math.max(1,Math.min(20000,deadline-Date.now()))}), scope.signal);
        scope.signal.throwIfAborted();
        if(result.isError) throw new Error('铁路上游查询失败');
        const text = result.content?.filter(x=>x.type==='text').map(x=>x.text).join('') || '';
        let rows;
        try { rows = JSON.parse(text); } catch { throw new Error('铁路服务未返回可解析数据'); }
        if (!Array.isArray(rows)) throw new Error('铁路返回格式不符合预期');
        onStatus('ready','最近查询成功');
        return rows;
      } catch (error) {
        onStatus(scope.signal.aborted?'idle':'unavailable',scope.signal.aborted?'铁路查询已停止':'最近查询失败，下次自动重连');
        // Detach synchronously before awaiting process shutdown.
        const cleanup = retire(owned);
        const cleanupScope = deadlineScope(null,1500);
        await abortable(()=>cleanup,cleanupScope.signal).catch(()=>{});
        cleanupScope.dispose();
        throw error;
      } finally { scope.dispose(); }
    }, {signal});
  }
  return {call, async close() {closed=true;await retire(connection);}};
}
