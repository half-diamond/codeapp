import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const OUTPUT_LIMIT = 64 * 1024;

function stopTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    killer.unref();
    child.kill('SIGKILL');
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
}

export function runCommand(command, args, { cwd, input = '', timeoutMs = 2000, outputLimit = OUTPUT_LIMIT, dockerName } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32'
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let overflow = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stopTree(child);
      if (dockerName) {
        const killer = spawn('docker', ['kill', dockerName], { stdio: 'ignore', windowsHide: true });
        killer.unref();
      }
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      if (Buffer.byteLength(stdout) + chunk.length > outputLimit) {
        overflow = true;
        stopTree(child);
      } else stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      if (Buffer.byteLength(stderr) < outputLimit) stderr += chunk.toString('utf8').slice(0, outputLimit);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ exitCode: -1, stdout, stderr: `${stderr}${error.message}`, timedOut, overflow });
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode: exitCode ?? -1, stdout, stderr, timedOut, overflow });
    });
    child.stdin.end(input);
  });
}

export class BaseExecutor {
  constructor({ mode = process.env.SANDBOX_MODE || 'local', timeoutMs = 2000, outputLimit = OUTPUT_LIMIT } = {}) {
    if (!['local', 'docker'].includes(mode)) throw new Error('SANDBOX_MODE must be local or docker');
    this.mode = mode;
    this.timeoutMs = timeoutMs;
    this.outputLimit = outputLimit;
  }

  async execute(code, testCases) {
    const dir = await mkdtemp(path.join(tmpdir(), 'codesync-'));
    const compileStarted = Date.now();
    try {
      await writeFile(path.join(dir, this.sourceName), code, { encoding: 'utf8', mode: 0o600 });
      const compile = await this.compile(dir);
      if (compile.timedOut) return { status: 'COMPILATION_ERROR', execTimeMs: Date.now() - compileStarted, message: compile.stderr };
      if (compile.exitCode !== 0) return { status: 'COMPILATION_ERROR', execTimeMs: Date.now() - compileStarted, message: compile.stderr.slice(0, 2000) };

      const runStarted = Date.now();
      for (const testCase of testCases) {
        const remaining = this.timeoutMs - (Date.now() - runStarted);
        if (remaining <= 0) return this.verdict('TLE', runStarted, 'Execution timed out');
        const run = await this.run(dir, testCase.input_data, remaining);
        if (run.timedOut) return this.verdict('TLE', runStarted, run.stderr);
        if (run.overflow) return this.verdict('RUNTIME_ERROR', runStarted, 'Output limit exceeded');
        if (run.exitCode !== 0) return this.verdict('RUNTIME_ERROR', runStarted, run.stderr);
        if (this.normalize(run.stdout) !== this.normalize(testCase.expected_output)) {
          return this.verdict('WRONG_ANSWER', runStarted, 'Output did not match');
        }
      }
      return this.verdict('ACCEPTED', runStarted, 'All test cases passed');
    } catch (error) {
      return this.verdict('RUNTIME_ERROR', compileStarted, error.message);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  normalize(output) {
    return output.replace(/\r\n/g, '\n').trimEnd();
  }

  verdict(status, started, message) {
    return { status, execTimeMs: Math.max(1, Date.now() - started), message: String(message || '').slice(0, 2000) };
  }

  dockerArgs(dir, image, name) {
    return [
      'run', '--rm', '--name', name, '--network', 'none', '--memory', '256m', '--cpus', '0.5',
      '--pids-limit', '64', '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m',
      '--mount', `type=bind,source=${dir},target=/workspace`, '-w', '/workspace', image
    ];
  }

  async command(dir, localCommand, localArgs, dockerImage, dockerArgs, input = '', timeoutMs = this.timeoutMs) {
    if (this.mode === 'local') {
      return runCommand(localCommand, localArgs, { cwd: dir, input, timeoutMs, outputLimit: this.outputLimit });
    }
    const name = `codesync-${randomUUID()}`;
    return runCommand('docker', [...this.dockerArgs(dir, dockerImage, name), ...dockerArgs], {
      cwd: dir, input, timeoutMs, outputLimit: this.outputLimit, dockerName: name
    });
  }
}
