// Runs async jobs one at a time, in call order. Message handling and the
// scheduler both read snapshots and write whole rows back, so they must
// never interleave (Harjyot's review on #14).
export function serial() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job, job);
    tail = run.catch(() => undefined); // a failed job doesn't block the next
    return run;
  };
}
