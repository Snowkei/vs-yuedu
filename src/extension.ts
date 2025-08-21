import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ReadingListProvider, FileItem, ChapterInfo } from './treeDataProvider';
import { FileConfigManager } from './fileConfig';

let readingListProvider: ReadingListProvider;
let outputChannel: vscode.OutputChannel;
let readingPanel: vscode.WebviewPanel | undefined; // 新增：阅读器面板

// 章节导航状态管理
let currentChapter: ChapterInfo | null = null;
let allChapters: ChapterInfo[] = [];
let currentChapterIndex: number = 0;
let chapterLines: string[] = [];

// 新增：状态栏按钮管理
let previousChapterStatusBarItem: vscode.StatusBarItem;
let switchToTerminalStatusBarItem: vscode.StatusBarItem;
let nextChapterStatusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    console.log('VS-YueDu插件已激活');

    // 初始化输出通道
    outputChannel = vscode.window.createOutputChannel('VS-YueDu');

    // 初始化树形数据提供器
    readingListProvider = new ReadingListProvider();
    
    // 注册侧边栏视图
    vscode.window.registerTreeDataProvider('vs-yuedu.sidebar', readingListProvider);

    // 监听配置变化，同步阅读列表
    const syncReadingListFromConfig = async () => {
        const config = vscode.workspace.getConfiguration('vs-yuedu');
        const readingListConfig = config.get<Array<{filePath: string, displayName?: string, lastReadChapter?: string, lastReadLine?: number}>>('readingList', []);
        
        // 获取当前内存中的文件列表
        const currentList = readingListProvider.getReadingList();
        
        // 构建新的文件列表
        const newList: string[] = [];
        const configMap = new Map<string, string | undefined>();
        
        // 收集配置中的文件
        for (const item of readingListConfig) {
            if (fs.existsSync(item.filePath)) {
                newList.push(item.filePath);
                configMap.set(item.filePath, item.displayName);
            } else {
                console.warn(`配置文件中的文件不存在: ${item.filePath}`);
            }
        }
        
        // 找出需要添加和删除的文件
        const toAdd = newList.filter(file => !currentList.includes(file));
        const toRemove = currentList.filter(file => !newList.includes(file));
        
        // 执行变更
        for (const filePath of toRemove) {
            await readingListProvider.removeFile(filePath);
        }
        
        for (const filePath of toAdd) {
            readingListProvider.addFile(filePath);
            const displayName = configMap.get(filePath);
            if (displayName && displayName !== path.basename(filePath)) {
                await FileConfigManager.getInstance().setDisplayName(filePath, displayName);
            }
        }
        
        // 更新现有文件的显示名称
        for (const filePath of newList) {
            if (currentList.includes(filePath)) {
                const displayName = configMap.get(filePath);
                if (displayName && displayName !== path.basename(filePath)) {
                    await FileConfigManager.getInstance().setDisplayName(filePath, displayName);
                }
            }
        }
        
        console.log(`配置同步完成：添加 ${toAdd.length} 个，删除 ${toRemove.length} 个文件`);
        if (toAdd.length > 0 || toRemove.length > 0) {
            readingListProvider.refresh();
        }
    };

    // 初始同步配置
    syncReadingListFromConfig();
    
    // 自动跳转到上次阅读位置
    const autoJumpToLastRead = async () => {
        const readingList = readingListProvider.getReadingList();
        if (readingList.length === 0) {
            return;
        }

        // 查找有阅读记录的文件
        for (const filePath of readingList) {
            const progress = FileConfigManager.getInstance().getReadingProgress(filePath);
            if (progress.chapterTitle) {
                try {
                    const chapters = await readingListProvider.identifyChapters(filePath);
                    const chapter = chapters.find(c => c.title === progress.chapterTitle);
                    if (chapter) {
                        readChapterInTerminal(chapter, chapters);
                        vscode.window.showInformationMessage(`已自动跳转到上次阅读位置: ${path.basename(filePath)} - ${progress.chapterTitle}`);
                        break;
                    }
                } catch (error) {
                    console.error(`自动跳转失败: ${filePath}`, error);
                }
            }
        }
    };

    // 移除自动跳转功能，改为手动触发

    // 监听配置变化
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('vs-yuedu.readingList')) {
                await syncReadingListFromConfig();
            }
        })
    );

    // 添加文件到阅读列表
    let addFileCommand = vscode.commands.registerCommand('vs-yuedu.addFile', async (uri: vscode.Uri) => {
        if (uri && uri.fsPath) {
            const filePath = uri.fsPath;
            readingListProvider.addFile(filePath);
            await FileConfigManager.getInstance().setDisplayName(filePath, path.basename(filePath));
            vscode.window.showInformationMessage(`已添加文件到阅读列表: ${path.basename(filePath)}`);
        } else {
            vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                openLabel: '选择文件'
            }).then(async fileUri => {
                if (fileUri && fileUri[0]) {
                    const filePath = fileUri[0].fsPath;
                    readingListProvider.addFile(filePath);
                    await FileConfigManager.getInstance().setDisplayName(filePath, path.basename(filePath));
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
    let readChapterCommand = vscode.commands.registerCommand('vs-yuedu.readChapter', (chapter: ChapterInfo, chapters?: ChapterInfo[]) => {
        readChapterInTerminal(chapter, chapters);
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
    
    // 注册章节导航和终端切换命令
    const previousChapterCommand = vscode.commands.registerCommand('vs-yuedu.previousChapter', async () => {
        if (allChapters.length > 0 && currentChapterIndex > 0) {
            currentChapterIndex--;
            currentChapter = allChapters[currentChapterIndex];
            
            const content = fs.readFileSync(currentChapter.filePath, 'utf-8');
            const lines = content.split('\n');
            chapterLines = lines.slice(currentChapter.startLine, currentChapter.endLine + 1);
            
            // 保存阅读记录
            await FileConfigManager.getInstance().setReadingProgress(
                currentChapter.filePath,
                currentChapter.title,
                currentChapter.startLine
            );
            
            readingListProvider.refresh();
            displayChapter();
        }
    });
    
    const nextChapterCommand = vscode.commands.registerCommand('vs-yuedu.nextChapter', async () => {
        if (allChapters.length > 0 && currentChapterIndex < allChapters.length - 1) {
            currentChapterIndex++;
            currentChapter = allChapters[currentChapterIndex];
            
            const content = fs.readFileSync(currentChapter.filePath, 'utf-8');
            const lines = content.split('\n');
            chapterLines = lines.slice(currentChapter.startLine, currentChapter.endLine + 1);
            
            // 保存阅读记录
            await FileConfigManager.getInstance().setReadingProgress(
                currentChapter.filePath,
                currentChapter.title,
                currentChapter.startLine
            );
            
            readingListProvider.refresh();
            displayChapter();
        }
    });
    
    const switchToTerminalCommand = vscode.commands.registerCommand('vs-yuedu.switchToTerminal', () => {
        // 获取当前活动的编辑器
        const activeEditor = vscode.window.activeTextEditor;
        const activeTerminal = vscode.window.activeTerminal;
        
        // 检查当前是否在VS-YueDu的输出通道中
        const isInYueDuOutput = outputChannel && 
            vscode.window.visibleTextEditors.some(editor => 
                editor.document.uri.scheme === 'output' && 
                editor.document.fileName.includes('VS-YueDu')
            );
        
        if (currentChapter && (isInYueDuOutput || activeTerminal)) {
            // 如果在yuedu中或在终端中，切换到终端
            vscode.commands.executeCommand('workbench.action.terminal.focus');
            vscode.window.showInformationMessage('已切换到终端');
        } else {
            // 如果在其他地方，且有阅读记录，跳回阅读
            if (currentChapter) {
                // 显示VS-YueDu输出通道
                outputChannel.show();
                vscode.window.showInformationMessage('已返回阅读');
            } else {
                // 如果没有当前阅读，尝试跳转到上次阅读位置
                vscode.commands.executeCommand('vs-yuedu.gotoLastRead');
            }
        }
    });
    
    // 跳转到上次阅读位置
    const gotoLastReadCommand = vscode.commands.registerCommand('vs-yuedu.gotoLastRead', async (fileUri?: vscode.Uri) => {
        let targetFile: string | null = null;
        let targetChapter: string | null = null;
        let targetLine: number = 0;

        // 如果提供了文件路径（从图形化列表调用）
        if (fileUri && fileUri.fsPath) {
            targetFile = fileUri.fsPath;
        } else {
            // 全局跳转：查找有阅读记录的文件
            const readingList = readingListProvider.getReadingList();
            if (readingList.length === 0) {
                vscode.window.showInformationMessage('阅读列表为空，请先添加文件');
                return;
            }

            for (const filePath of readingList) {
                const progress = FileConfigManager.getInstance().getReadingProgress(filePath);
                if (progress.chapterTitle) {
                    targetFile = filePath;
                    targetChapter = progress.chapterTitle;
                    targetLine = progress.lineNumber || 0;
                    break;
                }
            }

            if (!targetFile || !targetChapter) {
                vscode.window.showInformationMessage('暂无阅读记录，请先阅读任意章节');
                return;
            }
        }

        try {
            // 获取阅读记录
            if (fileUri && fileUri.fsPath) {
                const progress = FileConfigManager.getInstance().getReadingProgress(targetFile);
                if (!progress.chapterTitle) {
                    vscode.window.showInformationMessage('该文件暂无阅读记录，请先阅读任意章节');
                    return;
                }
                targetChapter = progress.chapterTitle;
                targetLine = progress.lineNumber || 0;
            }

            // 识别文件章节
            const chapters = await new ReadingListProvider().identifyChapters(targetFile);
            const chapter = chapters.find(c => c.title === targetChapter);
            
            if (!chapter) {
                vscode.window.showWarningMessage(`未找到章节 "${targetChapter}"，将从头开始阅读`);
                const firstChapter = chapters[0];
                if (firstChapter) {
                    readChapterInTerminal(firstChapter, chapters);
                }
                return;
            }

            // 跳转到指定章节
            readChapterInTerminal(chapter, chapters);
            vscode.window.showInformationMessage(`已跳转到上次阅读位置: ${path.basename(targetFile)} - ${targetChapter}`);

        } catch (error) {
            vscode.window.showErrorMessage(`跳转到阅读记录失败: ${error}`);
        }
    });

    context.subscriptions.push(previousChapterCommand);
    context.subscriptions.push(nextChapterCommand);
    context.subscriptions.push(switchToTerminalCommand);
    context.subscriptions.push(gotoLastReadCommand);

    // 创建状态栏按钮 - 左侧对齐的三个功能按钮
    previousChapterStatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
    );
    previousChapterStatusBarItem.text = "$(chevron-left)";
    previousChapterStatusBarItem.tooltip = "上一章";
    previousChapterStatusBarItem.command = "vs-yuedu.previousChapter";

    switchToTerminalStatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        99
    );
    switchToTerminalStatusBarItem.text = "$(terminal)";
    switchToTerminalStatusBarItem.tooltip = "切换到终端（老板键）";
    switchToTerminalStatusBarItem.command = "vs-yuedu.switchToTerminal";

    nextChapterStatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        98
    );
    nextChapterStatusBarItem.text = "$(chevron-right)";
    nextChapterStatusBarItem.tooltip = "下一章";
    nextChapterStatusBarItem.command = "vs-yuedu.nextChapter";

    // 初始隐藏状态栏按钮
    previousChapterStatusBarItem.hide();
    switchToTerminalStatusBarItem.hide();
    nextChapterStatusBarItem.hide();

    // 注册状态栏项目
    context.subscriptions.push(previousChapterStatusBarItem);
    context.subscriptions.push(switchToTerminalStatusBarItem);
    context.subscriptions.push(nextChapterStatusBarItem);
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
    
    // 根据比率计算每行正文对应的掩饰代码行数
    // 例如 ratio=0.3 表示一行正文对应3行掩饰代码
    const codeLinesPerContentLine = Math.max(1, Math.round(ratio * 10));
    
    for (const contentLine of originalLines) {
        // 先添加掩饰代码
        for (let i = 0; i < codeLinesPerContentLine; i++) {
            mixedLines.push(generateRandomCode());
        }
        
        // 然后添加正文内容
        mixedLines.push(contentLine);
    }
    
    return mixedLines;
}

async function readChapterInTerminal(chapter: ChapterInfo, chapters?: ChapterInfo[]) {
    try {
        // 保存当前章节状态
        currentChapter = chapter;
        
        // 如果提供了章节列表，保存用于导航
        if (chapters) {
            allChapters = chapters;
            currentChapterIndex = chapters.findIndex(c => 
                c.title === chapter.title && c.startLine === chapter.startLine
            );
        }
        
        const content = fs.readFileSync(chapter.filePath, 'utf-8');
        const lines = content.split('\n');
        chapterLines = lines.slice(chapter.startLine, chapter.endLine + 1);
        
        // 保存阅读记录
        await FileConfigManager.getInstance().setReadingProgress(
            chapter.filePath,
            chapter.title,
            chapter.startLine
        );
        
        // 刷新阅读列表以显示阅读标记
        readingListProvider.refresh();
        
        displayChapter();
        
    } catch (error) {
        vscode.window.showErrorMessage(`无法读取文件: ${error}`);
    }
}

// 更新状态栏按钮的可见性
function updateStatusBarVisibility() {
    if (currentChapter) {
        // 显示所有三个状态栏按钮
        previousChapterStatusBarItem.show();
        switchToTerminalStatusBarItem.show();
        nextChapterStatusBarItem.show();
        
        // 更新上一章按钮的启用状态
        const hasPrevious = allChapters.length > 0 && currentChapterIndex > 0;
        previousChapterStatusBarItem.text = hasPrevious ? "$(chevron-left)" : "$(circle-slash)";
        previousChapterStatusBarItem.tooltip = hasPrevious ? "上一章" : "已是第一章";
        
        // 更新下一章按钮的启用状态
        const hasNext = allChapters.length > 0 && currentChapterIndex < allChapters.length - 1;
        nextChapterStatusBarItem.text = hasNext ? "$(chevron-right)" : "$(circle-slash)";
        nextChapterStatusBarItem.tooltip = hasNext ? "下一章" : "已是最后一章";
    } else {
        // 隐藏所有状态栏按钮
        previousChapterStatusBarItem.hide();
        switchToTerminalStatusBarItem.hide();
        nextChapterStatusBarItem.hide();
    }
}

// 显示章节内容
function displayChapter() {
    if (!currentChapter) return;
    
    const config = vscode.workspace.getConfiguration('vs-yuedu');
    const enableRandomCode = config.get<boolean>('enableRandomCode', false);
    const randomCodeRatio = config.get<number>('randomCodeRatio', 0.3);
    
    const fileStats = fs.statSync(currentChapter.filePath);
    const fileSizeInMB = fileStats.size / (1024 * 1024);
    
    // 构建要显示的内容
    const fileName = path.basename(currentChapter.filePath);
    const separator = '═'.repeat(60);
    
    let contentLines: string[] = [];
    
    // 显示章节信息
    contentLines.push(separator);
    contentLines.push(`📖 正在阅读: ${fileName}`);
    contentLines.push(`📑 章节: ${currentChapter.title}`);
    contentLines.push(`📊 共 ${currentChapter.lineCount} 行`);
    contentLines.push(`📁 文件大小: ${fileSizeInMB.toFixed(1)}MB`);
    
    if (allChapters.length > 1) {
        contentLines.push(`📚 章节进度: ${currentChapterIndex + 1}/${allChapters.length}`);
    }
    
    if (enableRandomCode) {
        contentLines.push(`🎲 随机代码模式: 开启 (${(randomCodeRatio * 100).toFixed(0)}%)`);
    }
    
    contentLines.push(separator);
    contentLines.push('');
    
    // 根据配置决定是否混合随机代码
    let displayLines: string[] = [];
    if (enableRandomCode) {
        displayLines = mixRandomCode(chapterLines, randomCodeRatio);
    } else {
        displayLines = chapterLines;
    }
    
    // 显示内容，区分运行日志和正文
    displayLines.forEach((line, index) => {
        const originalLineNum = currentChapter!.startLine + index + 1;
        const displayLine = line || '';
        
        if (displayLine.match(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \w+ \w+:/)) {
            // 识别为运行日志格式
            contentLines.push(`${originalLineNum.toString().padStart(4, ' ')}: 📊 ${displayLine}`);
        } else {
            // 正文内容
            contentLines.push(`${originalLineNum.toString().padStart(4, ' ')}: 📄 ${displayLine}`);
        }
    });
    
    if (enableRandomCode) {
        contentLines.push('');
        contentLines.push('📋 图例:');
        contentLines.push('📊 运行日志（干扰项）');
        contentLines.push('📄 正文内容');
        contentLines.push('💡 可在设置中关闭随机代码模式');
    }
    
    // 恢复原始显示逻辑：直接清除并显示内容
    outputChannel.clear();
    outputChannel.show();
    
    // 一次性添加所有内容
    const fullContent = contentLines.join('\n');
    outputChannel.append(fullContent);
    
    // 更新状态栏按钮可见性
    updateStatusBarVisibility();
}

export function deactivate() {
    console.log('VS-YueDu插件已停用');
    if (outputChannel) {
        outputChannel.dispose();
    }
}