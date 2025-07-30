import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface FileConfig {
    filePath: string;
    displayName: string;
    lastReadChapter?: string;
    lastReadLine?: number;
}

export class FileConfigManager {
    private static instance: FileConfigManager;

    private constructor() {}

    public static getInstance(): FileConfigManager {
        if (!FileConfigManager.instance) {
            FileConfigManager.instance = new FileConfigManager();
        }
        return FileConfigManager.instance;
    }

    private getConfig(): FileConfig[] {
        const config = vscode.workspace.getConfiguration('vs-yuedu');
        return config.get<FileConfig[]>('readingList', []);
    }

    private async updateConfig(fileConfigs: FileConfig[]): Promise<void> {
        const config = vscode.workspace.getConfiguration('vs-yuedu');
        await config.update('readingList', fileConfigs, vscode.ConfigurationTarget.Global);
    }

    public getDisplayName(filePath: string): string {
        const configs = this.getConfig();
        const config = configs.find(item => item.filePath === filePath);
        return config ? config.displayName : path.basename(filePath);
    }

    public async setDisplayName(filePath: string, displayName: string): Promise<void> {
        const configs = this.getConfig();
        const existingIndex = configs.findIndex(item => item.filePath === filePath);
        
        // 检查是否真的需要更新
        if (existingIndex >= 0) {
            if (configs[existingIndex].displayName === displayName) {
                return; // 显示名称没有变化，不需要更新
            }
            configs[existingIndex].displayName = displayName;
        } else {
            configs.push({ 
                filePath, 
                displayName,
                lastReadChapter: undefined,
                lastReadLine: undefined
            });
        }
        await this.updateConfig(configs);
    }

    public async removeFile(filePath: string): Promise<void> {
        const configs = this.getConfig();
        const filteredConfigs = configs.filter(item => item.filePath !== filePath);
        await this.updateConfig(filteredConfigs);
    }

    public getAllConfigs(): FileConfig[] {
        return this.getConfig();
    }

    public hasCustomName(filePath: string): boolean {
        const configs = this.getConfig();
        return configs.some(item => item.filePath === filePath && item.displayName !== path.basename(filePath));
    }

    public async setReadingProgress(filePath: string, chapterTitle: string, lineNumber: number): Promise<void> {
        const configs = this.getConfig();
        const existingIndex = configs.findIndex(item => item.filePath === filePath);
        
        // 检查是否真的需要更新
        if (existingIndex >= 0) {
            const existing = configs[existingIndex];
            if (existing.lastReadChapter === chapterTitle && existing.lastReadLine === lineNumber) {
                return; // 阅读进度没有变化，不需要更新
            }
            existing.lastReadChapter = chapterTitle;
            existing.lastReadLine = lineNumber;
        } else {
            configs.push({
                filePath,
                displayName: path.basename(filePath),
                lastReadChapter: chapterTitle,
                lastReadLine: lineNumber
            });
        }
        await this.updateConfig(configs);
    }

    public getReadingProgress(filePath: string): { chapterTitle?: string; lineNumber?: number } {
        const configs = this.getConfig();
        const config = configs.find(item => item.filePath === filePath);
        return config ? {
            chapterTitle: config.lastReadChapter,
            lineNumber: config.lastReadLine
        } : {};
    }
}