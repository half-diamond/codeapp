import path from 'node:path';
import { BaseExecutor } from './base.js';

const python = process.platform === 'win32' ? 'python' : 'python3';

export class PythonExecutor extends BaseExecutor {
  constructor(options) {
    super(options);
    this.sourceName = 'main.py';
  }

  compile(dir) {
    return this.command(dir, python, ['-m', 'py_compile', path.join(dir, this.sourceName)],
      'python:3.11-alpine', ['python', '-m', 'py_compile', '/workspace/main.py'], '', 10000);
  }

  run(dir, input, timeoutMs = this.timeoutMs) {
    return this.command(dir, python, ['-B', path.join(dir, this.sourceName)],
      'python:3.11-alpine', ['python', '-B', '/workspace/main.py'], input, timeoutMs);
  }
}
