import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ReadingListProvider, FileItem, ChapterInfo } from './treeDataProvider';

let readingListProvider: ReadingListProvider;
let outputChannel: vscode.OutputChannel;

// 分页状态管理
let currentChapter: ChapterInfo | null = null;
let currentPage: number = 0;
let totalPages: number = 0;
let chapterLines: string[] = [];
const LINES_PER_PAGE = 50; // 每页显示50行

export function activate(context: vscode.ExtensionContext) {
    console.log('VS阅读器插件已激活');

    // 初始化输出通道
    outputChannel = vscode.window.createOutputChannel('VS阅读器');

    // 初始化树形数据提供器
    readingListProvider = new ReadingListProvider();
    
    // 注册侧边栏视图
    vscode.window.registerTreeDataProvider('vs-yuedu.sidebar', readingListProvider);

    // 添加文件到阅读列表
    let addFileCommand = vscode.commands.registerCommand('vs-yuedu.addFile', (uri: vscode.Uri) => {
        if (uri && uri.fsPath) {
            const filePath = uri.fsPath;
            readingListProvider.addFile(filePath);
            vscode.window.showInformationMessage(`已添加文件到阅读列表: ${path.basename(filePath)}`);
        } else {
            vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                openLabel: '选择文件'
            }).then(fileUri => {
                if (fileUri && fileUri[0]) {
                    const filePath = fileUri[0].fsPath;
                    readingListProvider.addFile(filePath);
                    vscode.window.showInformationMessage(`已添加文件到阅读列表: ${path.basename(filePath)}`);
                }
            });
        }
    });

    // 刷新阅读列表
    let refreshCommand = vscode.commands.registerCommand('vs-yuedu.refresh', () => {
        readingListProvider.refresh();
    });

    // 打开文件章节
    let openFileChaptersCommand = vscode.commands.registerCommand('vs-yuedu.openFileChapters', (filePath: string) => {
        // 这个命令主要用于展开树形结构，实际功能由树形视图处理
        vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
    });

    // 阅读章节
    let readChapterCommand = vscode.commands.registerCommand('vs-yuedu.readChapter', (chapter: ChapterInfo) => {
        readChapterInTerminal(chapter);
    });

    // 从树形视图中移除文件
    let removeFileCommand = vscode.commands.registerCommand('vs-yuedu.removeFile', (item: FileItem) => {
        if (item.filePath) {
            readingListProvider.removeFile(item.filePath);
            vscode.window.showInformationMessage(`已从阅读列表中移除: ${path.basename(item.filePath)}`);
        }
    });

    // 清理输出通道
    context.subscriptions.push({
        dispose: () => {
            if (outputChannel) {
                outputChannel.dispose();
            }
        }
    });

    context.subscriptions.push(addFileCommand);
    context.subscriptions.push(refreshCommand);
    context.subscriptions.push(openFileChaptersCommand);
    context.subscriptions.push(readChapterCommand);
    context.subscriptions.push(removeFileCommand);
    
    // 注册分页和终端切换命令
    const previousPageCommand = vscode.commands.registerCommand('vs-yuedu.previousPage', () => {
        if (currentPage > 0) {
            currentPage--;
            displayPage();
        }
    });
    
    const nextPageCommand = vscode.commands.registerCommand('vs-yuedu.nextPage', () => {
        if (currentPage < totalPages - 1) {
            currentPage++;
            displayPage();
        }
    });
    
    const switchToTerminalCommand = vscode.commands.registerCommand('vs-yuedu.switchToTerminal', () => {
        if (outputChannel) {
            outputChannel.show();
        }
    });
    
    context.subscriptions.push(previousPageCommand);
    context.subscriptions.push(nextPageCommand);
    context.subscriptions.push(switchToTerminalCommand);
}

function generateRandomCode(): string {
    const logLevels = ["INFO", "DEBUG", "WARN", "ERROR"];
    const logComponents = [
        "DatabaseManager", "UserService", "FileProcessor", "CacheManager", 
        "NetworkClient", "DataValidator", "AuthService", "LogManager",
        "ConfigLoader", "APIHandler", "StorageService", "TaskScheduler"
    ];
    const logActions = [
        "initialized successfully", "processing request", "data validation passed",
        "cache updated", "connection established", "operation completed",
        "warning threshold reached", "error occurred during processing",
        "user authenticated", "file loaded", "database query executed",
        "memory usage optimized", "service restarted", "timeout detected"
    ];
    
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const level = logLevels[Math.floor(Math.random() * logLevels.length)];
    const component = logComponents[Math.floor(Math.random() * logComponents.length)];
    const action = logActions[Math.floor(Math.random() * logActions.length)];
    
    return `[${timestamp}] ${level} ${component}: ${action}`;
}



function mixRandomCode(originalLines: string[], ratio: number): string[] {
    const mixedLines: string[] = [];
    const totalLines = originalLines.length;
    const codeLinesCount = Math.floor(totalLines * ratio);
    const minSpacing = Math.max(3, Math.floor(totalLines / codeLinesCount / 2)); // 最小间隔3行
    
    // 智能选择插入位置，确保间隔
    const insertPositions = new Set<number>();
    let lastInsert = -minSpacing;
    
    for (let i = 0; i < codeLinesCount; i++) {
        let attempts = 0;
        let pos;
        do {
            pos = lastInsert + minSpacing + Math.floor(Math.random() * (totalLines / codeLinesCount));
            attempts++;
        } while ((pos <= lastInsert + minSpacing - 1 || pos >= totalLines + insertPositions.size) && attempts < 50);
        
        if (pos >= 0 && pos < totalLines + insertPositions.size) {
            insertPositions.add(pos);
            lastInsert = pos;
        }
    }
    
    let originalIndex = 0;
    for (let i = 0; i < totalLines + insertPositions.size; i++) {
        if (insertPositions.has(i)) {
            mixedLines.push(generateRandomCode());
        } else if (originalIndex < originalLines.length) {
            mixedLines.push(originalLines[originalIndex]);
            originalIndex++;
        }
    }
    
    return mixedLines;
}

async function readChapterInTerminal(chapter: ChapterInfo) {
    try {
        // 保存当前章节状态
        currentChapter = chapter;
        currentPage = 0;
        
        const content = fs.readFileSync(chapter.filePath, 'utf-8');
        const lines = content.split('\n');
        chapterLines = lines.slice(chapter.startLine, chapter.endLine + 1);
        
        // 计算总页数
        totalPages = Math.ceil(chapterLines.length / LINES_PER_PAGE);
        
        displayPage();
        
    } catch (error) {
        vscode.window.showErrorMessage(`无法读取文件: ${error}`);
    }
}

function displayPage() {
    if (!currentChapter) return;
    
    const config = vscode.workspace.getConfiguration('vs-yuedu');
    const enableRandomCode = config.get<boolean>('enableRandomCode', false);
    const randomCodeRatio = config.get<number>('randomCodeRatio', 0.3);
    
    const fileStats = fs.statSync(currentChapter.filePath);
    const fileSizeInMB = fileStats.size / (1024 * 1024);
    
    // 计算当前页的行范围
    const startLine = currentPage * LINES_PER_PAGE;
    const endLine = Math.min(startLine + LINES_PER_PAGE, chapterLines.length);
    const pageLines = chapterLines.slice(startLine, endLine);
    
    outputChannel.clear();
    outputChannel.show();
    
    const fileName = path.basename(currentChapter.filePath);
    const separator = '═'.repeat(60);
    
    // 显示章节信息和分页信息
    outputChannel.appendLine(separator);
    outputChannel.appendLine(`📖 正在阅读: ${fileName}`);
    outputChannel.appendLine(`📑 章节: ${currentChapter.title}`);
    outputChannel.appendLine(`📊 共 ${currentChapter.lineCount} 行`);
    outputChannel.appendLine(`📁 文件大小: ${fileSizeInMB.toFixed(1)}MB`);
    outputChannel.appendLine(`📄 当前页: ${currentPage + 1}/${totalPages} (${startLine + 1}-${endLine}行)`);
    
    if (enableRandomCode) {
        outputChannel.appendLine(`🎲 随机代码模式: 开启 (${(randomCodeRatio * 100).toFixed(0)}%)`);
    }
    
    outputChannel.appendLine(separator);
    outputChannel.appendLine('');
    
    // 根据配置决定是否混合随机代码
    let displayLines: string[];
    if (enableRandomCode) {
        displayLines = mixRandomCode(pageLines, randomCodeRatio);
    } else {
        displayLines = pageLines;
    }
    
    // 显示内容，区分运行日志和正文
    displayLines.forEach((line, index) => {
        const originalLineNum = startLine + index + 1;
        const displayLine = line || '';
        
        if (displayLine.match(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \w+ \w+:/)) {
            // 识别为运行日志格式
            outputChannel.appendLine(`${originalLineNum.toString().padStart(4, ' ')}: 📊 ${displayLine}`);
        } else {
            // 正文内容
            outputChannel.appendLine(`${originalLineNum.toString().padStart(4, ' ')}: 📄 ${displayLine}`);
        }
    });
    
    // 显示分页提示
    outputChannel.appendLine('');
    outputChannel.appendLine(separator);
    outputChannel.appendLine('🎯 分页控制:');
    outputChannel.appendLine('⬅️  Ctrl+Shift+Alt+P / Cmd+Shift+Alt+P: 上一页');
    outputChannel.appendLine('➡️  Ctrl+Shift+Alt+N / Cmd+Shift+Alt+N: 下一页');
    outputChannel.appendLine('🖥️  Ctrl+Shift+Alt+T / Cmd+Shift+Alt+T: 切换到终端');
    
    if (enableRandomCode) {
        outputChannel.appendLine('');
        outputChannel.appendLine('📋 图例:');
        outputChannel.appendLine('📊 运行日志（干扰项）');
        outputChannel.appendLine('📄 正文内容');
        outputChannel.appendLine('💡 可在设置中关闭随机代码模式');
    }
}

export function deactivate() {
    console.log('VS阅读器插件已停用');
    if (outputChannel) {
        outputChannel.dispose();
    }
}