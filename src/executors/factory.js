import { CppExecutor } from './cpp.js';
import { PythonExecutor } from './python.js';

export class ExecutorFactory {
  static create(lang, options) {
    if (lang === 'cpp') return new CppExecutor(options);
    if (lang === 'python') return new PythonExecutor(options);
    throw new Error(`Unsupported language: ${lang}`);
  }
}
