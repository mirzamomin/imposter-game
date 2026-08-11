import { spawn } from 'node:child_process'

function start(command, args, label) {
    const child = spawn(command, args, {
        stdio: 'inherit',
        shell: process.platform === 'win32',
    })

    child.on('exit', (code) => {
        if (code && code !== 0) {
            console.error(`${label} exited with code ${code}`)
            process.exitCode = code
        }
    })

    return child
}

const vite = start(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['exec', 'vite', '--', '--host', '0.0.0.0'],
    'vite',
)

const lobby = start(
    process.platform === 'win32' ? 'node.exe' : 'node',
    ['server/lobby-server.mjs'],
    'lobby server',
)

function stop() {
    vite.kill()
    lobby.kill()
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
