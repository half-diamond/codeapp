import path from 'node:path';
import { BaseExecutor } from './base.js';

export class CppExecutor extends BaseExecutor {
  constructor(options) {
    super(options);
    this.sourceName = 'main.cpp';
  }

  compile(dir) {
    return this.command(dir, 'g++', ['-std=c++17', '-O2', '-pipe', path.join(dir, this.sourceName), '-o', path.join(dir, 'program')],
      'gcc:13', ['g++', '-std=c++17', '-O2', '-pipe', 'main.cpp', '-o', '/workspace/program'], '', 20000);
  }

  run(dir, input, timeoutMs = this.timeoutMs) {
    return this.command(dir, path.join(dir, 'program'), [], 'gcc:13', ['/workspace/program'], input, timeoutMs);
  }
}
