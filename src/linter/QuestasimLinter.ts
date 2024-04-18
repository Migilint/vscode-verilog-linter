// SPDX-License-Identifier: MIT
import * as vscode from 'vscode';
import * as child from 'child_process';
import * as cwd from 'process'
import BaseLinter from './BaseLinter';
import { Logger } from '../logger';

var isWindows = process.platform === 'win32';

export default class ModelsimLinter extends BaseLinter {
  private questasimPath: string;
  private questasimArgs: string;
  private questasimWork: string;
  private questasimIncDirs: Array<string>;
  private questasimLstFiles: Array<string>;
  private questasimCompileFilePath: string;
  private questasimBuildDir: string;

  private runAtFileLocation: boolean;

  constructor(diagnosticCollection: vscode.DiagnosticCollection, logger: Logger) {
    super('questasim', diagnosticCollection, logger);
    vscode.workspace.onDidChangeConfiguration(() => {
      this.getConfig();
    });
    this.getConfig();
  }

  private getConfig() {
    this.questasimPath = <string>vscode.workspace.getConfiguration().get('verilog.linting.path');
    //get custom arguments
    this.questasimArgs = <string>(
      vscode.workspace.getConfiguration().get('verilog.linting.questasim.arguments')
    );
    this.questasimWork = <string>(
      vscode.workspace.getConfiguration().get('verilog.linting.questasim.work_dir')
    );
    this.questasimIncDirs = Array<string>(
        vscode.workspace.getConfiguration().get('verilog.linting.questasim.incdirs')
    );
    this.questasimLstFiles = Array<string>(
        vscode.workspace.getConfiguration().get('verilog.linting.questasim.lst_files')
    );
    this.questasimCompileFilePath = <string>(
        vscode.workspace.getConfiguration().get('verilog.linting.questasim.compile_file')
    );
    this.questasimBuildDir = <string>(
        vscode.workspace.getConfiguration().get('verilog.linting.questasim.build_dir')
    );
  }

  protected convertToSeverity(severityString: string): vscode.DiagnosticSeverity {
    switch (severityString) {
      case 'Error':
      case 'error':
      case 'Undefined':
      case 'Invalid':
      case 'Illegal':
      case 'Extra semicolon':
      case 'is allowed':
      case 'Identifier':
        return vscode.DiagnosticSeverity.Error;
      case 'Warning':
      case 'warning':
        return vscode.DiagnosticSeverity.Warning;
    }
    return vscode.DiagnosticSeverity.Information;
  }

  protected lint(doc: vscode.TextDocument) {

    this.questasimIncDirs = String(this.questasimIncDirs).split(',') // the very important places!!!!!

    this.logger.info('questasim lint requested');
    // this.logger.info(this.questasimBuildDir);
    // this.logger.info(String(this.questasimIncDirs));
    // this.logger.info(String(this.questasimLstFiles));
    // this.logger.info(this.questasimCompileFilePath);




    let runLocation: string = this.questasimBuildDir ? this.questasimBuildDir : vscode.workspace.workspaceFolders[0].uri.fsPath; //choose correct location to run
    // this.logger.info(runLocation)

    let incdirs: string = this.questasimIncDirs ? String(this.questasimIncDirs.map((x) => "+incdir+" + x)).replaceAll(",", " ") : "";
    // this.logger.info(String(this.questasimIncDirs))
    // this.logger.info(this.convertArrayToString(this.questasimIncDirs))
    // this.logger.info(incdirs)
    
    let lstFile: string = this.questasimLstFiles ? " -f " + this.questasimLstFiles[0] : "";
    // this.logger.info(lstFile)

    let compileFile: string = this.questasimCompileFilePath ? " -l " + this.questasimCompileFilePath : "";
    // this.logger.info(compileFile)

    let command: string = this.questasimPath + 'vlog ' +  lstFile +  compileFile + " -sv " + incdirs + " " + this.questasimArgs; 
    // Example command - vlog -f ./tb_files.lst -l ./compile.log -sv +incdir+../tb/base_vc +incdir+../tb/number_vc +incdir+../tb/out_vc +incdir+/tb
    this.logger.info(command)
    

    var process: child.ChildProcess = child.exec(
      command,
      { cwd: runLocation },
      (_error: Error, stdout: string, _stderr: string) => {
        let diagnostics: vscode.Diagnostic[] = [];
        let lines = stdout.split(/\r?\n/g);

        // ^\*\* (((Error)|(Warning))( \(suppressible\))?: )(\([a-z]+-[0-9]+\) )?([^\(]*\(([0-9]+)\): )(\([a-z]+-[0-9]+\) )?((((near|Unknown identifier|Undefined variable):? )?["']([\w:;\.]+)["'][ :.]*)?.*)
        // From https://github.com/dave2pi/SublimeLinter-contrib-vlog/blob/master/linter.py

        //     ([Ee]rror|[Ww]arning) - тип ошибки
        //     (\.sv|\.v)([\(](\d+)([:.]\d+)?[\)]) - номера строк (от и до, какой символ.)
        //     ((\.sv|\.v)([\(](\d+)([:.]\d+)?[\)])|Error|Warning):(.+) - сообщения
        //     (:|(at)).+(\.sv|\.v)([\(](\d+)([:.]\d+)?[\)]) - название файла

        // let regexExp =
          // '^\\*\\* (((Error)|(Warning))( \\(suppressible\\))?: )(\\([a-z]+-[0-9]+\\) )?([^\\(]*)\\(([0-9]+)\\): (\\([a-z]+-[0-9]+\\) )?((((near|Unknown identifier|Undefined variable):? )?["\']([\\w:;\\.]+)["\'][ :.]*)?.*)';
        // Parse output lines
        let regexExp_nameFiles = /[ \w-]+\.[sv|s]/g;
        let regexExp_typeError = /([Ee]rror|[Ww]arning|Undefined|Invalid|Illegal|Extra semicolon|is allowed|Identifier)/g;
        let regexExp_lineNumber = /(\.sv|\.v)([\(](\d+)([:.]\d+)?[\)])/g;
        let regexExp_msg = /((\.sv|\.v)([\(](\d+)([:.]\d+)?[\)])|Error|Warning):(.+)/g;
        // Parsing filenames from paths
        lines.forEach((line, _) => {
          if (line.startsWith('**')) {
            try {
              // let m = line.match(regexExp); // регулярное выражение прошлого владельца
              let nameFiles = line.match(regexExp_nameFiles); // регулярное выражение названия файла
              let typeError = line.match(regexExp_typeError); // тип ошибки
              let lineNumber = line.match(regexExp_lineNumber); // номер линии
              // let msg = line.match(regexExp_msg)[0]; // думал парсить сообщения чистое, но решил, что просто ошибку в msg закину и всё
              // this.logger.info(doc.fileName)
              this.logger.info(nameFiles[0])
              this.logger.info(typeError[0])
              this.logger.info("\n")
              // this.logger.info(doc.fileName.match(regexExp_nameFiles)[0])
              if (nameFiles[0] != doc.fileName.match(regexExp_nameFiles)[0]) {
                return; // если ошибки не на том файле, то их не показывать.
              }
              let lineNumStart = parseInt(lineNumber[0].match(/\d+/g)[0]) - 1;
              let lineNumEnd = lineNumber[0].match(/([:]\d+)/g) ? parseInt(lineNumber[0].match(/([:]\d+)/g)[0].match(/\d+/g)[0]) - 1 : lineNumStart;
              this.logger.info(lineNumber[0])
              this.logger.info(lineNumber[0].match(/\d+/g)[0])
              this.logger.info(String(lineNumStart))
              this.logger.info(String(lineNumEnd))
              this.logger.info(line)
              // let msg = m[10];
              diagnostics.push({
                severity: this.convertToSeverity(typeError[0]),
                range: new vscode.Range(lineNumStart, 0, lineNumEnd, Number.MAX_VALUE),
                message: line,
                code: 'questasim',
                source: 'questasim',
              });
            } catch (e) {
              diagnostics.push({
                severity: vscode.DiagnosticSeverity.Information,
                range: new vscode.Range(0, 0, 0, Number.MAX_VALUE),
                message: line,
                code: 'questasim',
                source: 'questasim',
              });
            }
          }
        });
        this.logger.info(diagnostics.length + ' errors/warnings returned');
        this.diagnosticCollection.set(doc.uri, diagnostics);
      }
    );
    process;
  }
}
