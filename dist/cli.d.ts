declare class CliArgumentError extends Error {
    constructor(message: string);
}
declare function parseCliArgs(): Record<string, string | boolean>;
declare function shouldShowHelp(): boolean;
declare function run(): Promise<void>;

export { CliArgumentError, parseCliArgs, run, shouldShowHelp };
