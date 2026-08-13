const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');

const DEFAULT_TOP = 30;
const DEFAULT_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.mts', '.mjs', '.cjs', '.css'];

function parseArgs(argv) {
    const args = {
        root: path.resolve(__dirname, '..'),
        top: DEFAULT_TOP,
        out: null,
        exts: DEFAULT_EXTS,
        excludeDirs: [
            'node_modules',
            'dist',
            'release',
            'models',
            'models_backup',
            'logs',
            '.git',
            '.trae',
            '.cursor',
            'C-649'
        ]
    };

    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (token === '--root') {
            args.root = path.resolve(argv[++i]);
        } else if (token === '--top') {
            args.top = Number(argv[++i]);
        } else if (token === '--out') {
            args.out = path.resolve(argv[++i]);
        } else if (token === '--ext') {
            const raw = String(argv[++i] || '');
            args.exts = raw.split(',').map(s => s.trim()).filter(Boolean).map(s => (s.startsWith('.') ? s : `.${s}`));
        } else if (token === '--exclude') {
            const raw = String(argv[++i] || '');
            args.excludeDirs = raw.split(',').map(s => s.trim()).filter(Boolean);
        }
    }

    if (!Number.isFinite(args.top) || args.top <= 0) {
        args.top = DEFAULT_TOP;
    }

    return args;
}

function toPosix(p) {
    return p.replace(/\\/g, '/');
}

function categorize(relPosix) {
    if (relPosix.startsWith('DesignEcho-Agent/src/')) return 'agent';
    if (relPosix.startsWith('DesignEcho-UXP/src/')) return 'uxp';
    if (relPosix.startsWith('docs/')) return 'docs';
    return 'other';
}

function formatFileLink(absPath, relPosix) {
    const url = pathToFileURL(absPath).toString();
    return `[${relPosix}](${url})`;
}

async function collectFiles(root, exts, excludeDirs) {
    const results = [];

    async function walk(dir) {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const abs = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (excludeDirs.includes(entry.name)) continue;
                await walk(abs);
                continue;
            }

            if (!entry.isFile()) continue;

            const ext = path.extname(entry.name).toLowerCase();
            if (!exts.includes(ext)) continue;

            const stat = await fs.stat(abs);
            const rel = path.relative(root, abs);
            const relPosix = toPosix(rel);
            results.push({
                abs,
                relPosix,
                category: categorize(relPosix),
                mtimeMs: stat.mtimeMs,
                size: stat.size
            });
        }
    }

    await walk(root);
    return results;
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
        value /= 1024;
        idx++;
    }
    const num = idx === 0 ? String(Math.round(value)) : value.toFixed(value >= 10 ? 1 : 2);
    return `${num} ${units[idx]}`;
}

function renderSection(title, rows, top, root) {
    const sorted = [...rows].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, top);
    const lines = [`## ${title}`, ''];
    if (sorted.length === 0) {
        lines.push('- （无匹配文件）', '');
        return lines.join('\n');
    }

    for (const r of sorted) {
        const link = formatFileLink(r.abs, r.relPosix);
        const when = new Date(r.mtimeMs).toISOString().replace('T', ' ').replace('Z', 'Z');
        lines.push(`- ${link} | ${when} | ${formatBytes(r.size)}`);
    }
    lines.push('');
    return lines.join('\n');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const files = await collectFiles(args.root, args.exts, args.excludeDirs);

    const groups = {
        agent: [],
        uxp: [],
        docs: [],
        other: []
    };

    for (const f of files) {
        groups[f.category] = groups[f.category] || [];
        groups[f.category].push(f);
    }

    const now = new Date().toISOString();
    const md = [
        '# 最近修改文件清单',
        '',
        `> 生成时间：${now}`,
        `> 统计口径：文件系统 mtime（不依赖 git）`,
        `> TopN：${args.top}`,
        `> 扩展名：${args.exts.join(', ')}`,
        `> 排除目录：${args.excludeDirs.join(', ')}`,
        '',
        renderSection('DesignEcho-Agent（src）', groups.agent, args.top, args.root),
        renderSection('DesignEcho-UXP（src）', groups.uxp, args.top, args.root),
        renderSection('docs', groups.docs, args.top, args.root),
        renderSection('其他（可选）', groups.other, args.top, args.root)
    ].join('\n');

    if (args.out) {
        await fs.mkdir(path.dirname(args.out), { recursive: true });
        await fs.writeFile(args.out, md, 'utf8');
        return;
    }

    process.stdout.write(md);
}

main().catch((e) => {
    process.stderr.write(String(e && e.stack ? e.stack : e));
    process.exitCode = 1;
});

