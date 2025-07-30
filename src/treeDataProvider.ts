import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FileConfigManager } from './fileConfig';

export class FileItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly filePath?: string,
        public readonly isFile: boolean = false,
        public readonly chapter?: ChapterInfo,
        public readonly chapters?: ChapterInfo[]
    ) {
        super(label, collapsibleState);
        
        if (isFile && filePath) {
            this.tooltip = filePath;
            this.description = path.dirname(filePath);
            this.command = {
                command: 'vs-yuedu.openFileChapters',
                title: '查看章节',
                arguments: [filePath]
            };
            this.iconPath = new vscode.ThemeIcon('file-text');
            this.contextValue = 'file';
        } else if (chapter) {
            this.tooltip = `${chapter.title} (${chapter.lineCount} 行)`;
            this.command = {
                command: 'vs-yuedu.readChapter',
                title: '阅读章节',
                arguments: [chapter, chapters]
            };
            this.iconPath = new vscode.ThemeIcon('book');
            this.description = `${chapter.startLine + 1}-${chapter.endLine + 1} 行`;
            this.contextValue = 'chapter';
        } else {
            this.iconPath = new vscode.ThemeIcon('folder');
        }
    }
}

export interface ChapterInfo {
    title: string;
    startLine: number;
    endLine: number;
    lineCount: number;
    filePath: string;
}

export class ReadingListProvider implements vscode.TreeDataProvider<FileItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<FileItem | undefined | null | void> = new vscode.EventEmitter<FileItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<FileItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private readingList: string[] = [];
    private fileConfigManager = FileConfigManager.getInstance();

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getReadingList(): string[] {
        return [...this.readingList];
    }

    addFile(filePath: string): void {
        if (!this.readingList.includes(filePath)) {
            this.readingList.push(filePath);
            this.refresh();
        }
    }

    async removeFile(filePath: string): Promise<void> {
        const index = this.readingList.indexOf(filePath);
        if (index > -1) {
            this.readingList.splice(index, 1);
            await this.fileConfigManager.removeFile(filePath); // 同步删除配置
            this.refresh();
        }
    }

    getTreeItem(element: FileItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: FileItem): Promise<FileItem[]> {
        if (!element) {
            // 根级别显示文件列表
            const validFiles: FileItem[] = [];
            
            for (const filePath of this.readingList) {
                if (fs.existsSync(filePath)) {
                    const displayName = this.fileConfigManager.getDisplayName(filePath);
                    const progress = this.fileConfigManager.getReadingProgress(filePath);
                    let labelWithProgress = displayName;
                    
                    if (progress.chapterTitle) {
                        labelWithProgress = `${displayName} 📖 ${progress.chapterTitle}`;
                    }
                    
                    validFiles.push(new FileItem(
                        labelWithProgress,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        filePath,
                        true
                    ));
                } else {
                    console.warn(`文件不存在，从阅读列表中移除: ${filePath}`);
                    // 自动移除不存在的文件
                    this.removeFile(filePath);
                }
            }
            
            return validFiles;
        } else if (element.filePath && !element.chapter) {
            // 文件级别显示章节
            if (!fs.existsSync(element.filePath)) {
                console.error(`文件不存在: ${element.filePath}`);
                return [];
            }
            
            try {
                const chapters = await this.identifyChapters(element.filePath);
                return chapters.map(chapter => 
                    new FileItem(
                        chapter.title,
                        vscode.TreeItemCollapsibleState.None,
                        undefined,
                        false,
                        chapter,
                        chapters
                    )
                );
            } catch (error) {
                console.error(`读取文件章节失败: ${element.filePath}`, error);
                return [new FileItem(
                    "读取文件失败",
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    false
                )];
            }
        }

        return [];
    }

    private cleanChapterTitle(title: string): string {
        return title
            .replace(/^#+\s*/, '')
            .replace(/={3,}\s*$/, '')
            .replace(/-{3,}\s*$/, '')
            .replace(/^\[\s*/, '')
            .replace(/\s*\]$/, '')
            .trim()
            .substring(0, 80); // 增加标题长度限制，保留章节号
    }

    private async identifyChapters(filePath: string): Promise<ChapterInfo[]> {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            const chapters: ChapterInfo[] = [];
            
            const chapterPatterns = [
                /^第[\d一二三四五六七八九十百千]+[章篇章节]/,
                /^第[\d一二三四五六七八九十百千]+章[\s\S]*$/,
                /^[\d一二三四五六七八九十百千]+[\.、\s][\s\S]*$/,
                /^[\d一二三四五六七八九十百千]+[章篇章节]/,
                /^Chapter\s+\d+[\s\S]*$/i,
                /^Section\s+\d+[\s\S]*$/i,
                /^\d+\.\s*[\u4e00-\u9fa5a-zA-Z]/,
                /^#+\s+.*$/,
                /^={3,}\s*.*\s*={3,}$/,
                /^-{3,}\s*.*\s*-{3,}$/,
                /^\[.*\]$/,
                /^\d{1,2}[:\s]/
            ];

            let currentChapter: ChapterInfo | null = null;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                
                // 过滤空行和纯分隔符行
                if (!line || line.match(/^[-=]{3,}$/) || line.match(/^[\s\-_=]+$/)) {
                    continue;
                }
                
                const isChapterTitle = chapterPatterns.some(pattern => pattern.test(line));
                
                if (isChapterTitle && line.length > 0 && line.length < 100) {
                    if (currentChapter) {
                        currentChapter.endLine = i - 1;
                        currentChapter.lineCount = currentChapter.endLine - currentChapter.startLine + 1;
                        chapters.push(currentChapter);
                    }
                    
                    currentChapter = {
                        title: this.cleanChapterTitle(line),
                        startLine: i,
                        endLine: lines.length - 1,
                        lineCount: 0,
                        filePath: filePath
                    };
                }
            }

            // 处理最后一个章节
            if (currentChapter) {
                currentChapter.endLine = lines.length - 1;
                currentChapter.lineCount = currentChapter.endLine - currentChapter.startLine + 1;
                chapters.push(currentChapter);
            }

            // 如果没有识别到章节，创建默认章节
            if (chapters.length === 0 && lines.length > 0) {
                chapters.push({
                    title: "全文",
                    startLine: 0,
                    endLine: lines.length - 1,
                    lineCount: lines.length,
                    filePath: filePath
                });
            }

            return chapters;
        } catch (error) {
            return [{
                title: "全文",
                startLine: 0,
                endLine: 0,
                lineCount: 1,
                filePath: filePath
            }];
        }
    }
}