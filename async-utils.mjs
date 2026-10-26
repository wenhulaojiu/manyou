export function abortable(work, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal?.addEventListener('abort', abort, {once: true});
    Promise.resolve().then(() => { signal?.throwIfAborted(); return work(); })
      .then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort));
  });
}

export function deadlineScope(parent, milliseconds) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('查询达到时限', 'TimeoutError')), Math.max(0, milliseconds));
  return {signal: parent ? AbortSignal.any([parent, controller.signal]) : controller.signal,
    dispose: () => clearTimeout(timer)};
}
