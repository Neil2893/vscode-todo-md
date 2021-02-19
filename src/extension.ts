import dayjs from 'dayjs';
import isBetween from 'dayjs/plugin/isBetween';
import isoWeek from 'dayjs/plugin/isoWeek';
import relativeTime from 'dayjs/plugin/relativeTime';
import vscode, { ExtensionContext, window, workspace } from 'vscode';
import { registerAllCommands } from './commands';
import { updateDecorationStyle } from './decorations';
import { resetAllRecurringTasks } from './documentActions';
import { checkIfNeedResetRecurringTasks, onChangeActiveTextEditor, updateEverything } from './events';
import { parseDocument } from './parse';
import { StatusBar } from './statusBar';
import { createAllTreeViews, groupAndSortTreeItems, updateAllTreeViews, updateArchivedTasks } from './treeViewProviders/treeViews';
import { ExtensionConfig, ExtensionState, VscodeContext } from './types';
import { getDocumentForDefaultFile } from './utils/extensionUtils';
import { setContext } from './utils/vscodeUtils';
import { TasksWebviewViewProvider } from './webview/webviewView';

dayjs.extend(isBetween);
dayjs.extend(relativeTime);
dayjs.extend(isoWeek);
dayjs.Ls.en.weekStart = 1;
/**
 * Things extension keeps a global reference to and uses extensively throughout the extension
 */
export const extensionState: ExtensionState = {
	tasks: [],
	tasksAsTree: [],
	tags: [],
	projects: [],
	contexts: [],
	tagsForTreeView: [],
	projectsForTreeView: [],
	contextsForTreeView: [],
	archivedTasks: [],
	commentLines: [],
	theRightFileOpened: false,
	lastVisitByFile: {},
	taskTreeViewFilterValue: '',
	extensionContext: {} as any as ExtensionContext,
	activeDocument: undefined,
	activeDocumentTabSize: 4,
};


export const EXTENSION_NAME = 'todomd';
export const LAST_VISIT_BY_FILE_STORAGE_KEY = 'LAST_VISIT_BY_FILE_STORAGE_KEY';

export let extensionConfig = workspace.getConfiguration(EXTENSION_NAME) as any as ExtensionConfig;
export const statusBar = new StatusBar();
/**
 * Global vscode variables
 */
export class Global {
	static webviewProvider: TasksWebviewViewProvider;

	static tagAutocompleteDisposable: vscode.Disposable;
	static projectAutocompleteDisposable: vscode.Disposable;
	static contextAutocompleteDisposable: vscode.Disposable;
	static generalAutocompleteDisposable: vscode.Disposable;
	static setDueDateAutocompleteDisposable: vscode.Disposable;

	static hoverDisposable: vscode.Disposable;

	static changeTextDocumentDisposable: vscode.Disposable;
	static changeActiveTextEditorDisposable: vscode.Disposable;

	static completedTaskDecorationType: vscode.TextEditorDecorationType;
	static commentDecorationType: vscode.TextEditorDecorationType;
	static priorityADecorationType: vscode.TextEditorDecorationType;
	static priorityBDecorationType: vscode.TextEditorDecorationType;
	static priorityCDecorationType: vscode.TextEditorDecorationType;
	static priorityDDecorationType: vscode.TextEditorDecorationType;
	static priorityEDecorationType: vscode.TextEditorDecorationType;
	static priorityFDecorationType: vscode.TextEditorDecorationType;
	static tagsDecorationType: vscode.TextEditorDecorationType;
	static specialTagDecorationType: vscode.TextEditorDecorationType;
	static tagsDelimiterDecorationType: vscode.TextEditorDecorationType;
	static projectDecorationType: vscode.TextEditorDecorationType;
	static contextDecorationType: vscode.TextEditorDecorationType;
	static notDueDecorationType: vscode.TextEditorDecorationType;
	static dueDecorationType: vscode.TextEditorDecorationType;
	static overdueDecorationType: vscode.TextEditorDecorationType;
	static invalidDueDateDecorationType: vscode.TextEditorDecorationType;
	static closestDueDateDecorationType: vscode.TextEditorDecorationType;
}

export async function activate(extensionContext: vscode.ExtensionContext) {
	extensionState.extensionContext = extensionContext;
	const lastVisitByFile = extensionContext.globalState.get<ExtensionState['lastVisitByFile'] | undefined>(LAST_VISIT_BY_FILE_STORAGE_KEY);
	extensionState.lastVisitByFile = lastVisitByFile ? lastVisitByFile : {};

	updateDecorationStyle();
	registerAllCommands();
	createAllTreeViews();

	const defaultFileDocument = await getDocumentForDefaultFile();
	if (defaultFileDocument) {
		const filePath = defaultFileDocument.uri.toString();
		const needReset = checkIfNeedResetRecurringTasks(filePath);
		if (needReset) {
			await resetAllRecurringTasks(defaultFileDocument, needReset.lastVisit);
			await updateLastVisitGlobalState(filePath, new Date());
		}
	}

	onChangeActiveTextEditor(window.activeTextEditor);
	await updateState();

	Global.webviewProvider = new TasksWebviewViewProvider(extensionState.extensionContext.extensionUri);
	extensionState.extensionContext.subscriptions.push(
		vscode.window.registerWebviewViewProvider(TasksWebviewViewProvider.viewType, Global.webviewProvider),
	);

	updateAllTreeViews();
	updateArchivedTasks();
	updateIsDevContext();

	Global.changeActiveTextEditorDisposable = window.onDidChangeActiveTextEditor(onChangeActiveTextEditor);

	function onConfigChange(e: vscode.ConfigurationChangeEvent): void {
		if (!e.affectsConfiguration(EXTENSION_NAME)) {
			return;
		}
		updateConfig();
	}

	function updateConfig(): void {
		extensionConfig = workspace.getConfiguration(EXTENSION_NAME) as any as ExtensionConfig;

		disposeEditorDisposables();
		updateDecorationStyle();
		updateEverything();
		updateIsDevContext();
	}
	function updateIsDevContext() {
		if (process.env.NODE_ENV === 'development' || extensionConfig.isDev) {
			setContext(VscodeContext.isDev, true);
		}
	}

	extensionContext.subscriptions.push(workspace.onDidChangeConfiguration(onConfigChange));
}
/**
 * Update primary `state` properties, such as `tasks` or `tags`, based on provided document or based on default file
 */
export async function updateState() {
	let document = extensionState.activeDocument;
	if (!document) {
		document = await getDocumentForDefaultFile();
	}
	if (!document) {
		extensionState.tasks = [];
		extensionState.tasksAsTree = [];
		extensionState.tags = [];
		extensionState.projects = [];
		extensionState.contexts = [];
		extensionState.tagsForTreeView = [];
		extensionState.projectsForTreeView = [];
		extensionState.contextsForTreeView = [];
		extensionState.commentLines = [];
		extensionState.theRightFileOpened = false;
		extensionState.activeDocument = undefined;
		return;
	}
	const parsedDocument = await parseDocument(document);

	extensionState.tasks = parsedDocument.tasks;
	extensionState.tasksAsTree = parsedDocument.tasksAsTree;
	extensionState.commentLines = parsedDocument.commentLines;

	const treeItems = groupAndSortTreeItems(extensionState.tasksAsTree);
	extensionState.tagsForTreeView = treeItems.sortedTagsForProvider;
	extensionState.projectsForTreeView = treeItems.projectsForProvider;
	extensionState.contextsForTreeView = treeItems.contextsForProvider;
	extensionState.tags = treeItems.tags;
	extensionState.projects = treeItems.projects;
	extensionState.contexts = treeItems.contexts;
}
function disposeEditorDisposables(): void {
	if (Global.completedTaskDecorationType) {
		// if one set - that means that all decorations are set
		Global.completedTaskDecorationType.dispose();
		Global.commentDecorationType.dispose();
		Global.priorityADecorationType.dispose();
		Global.priorityBDecorationType.dispose();
		Global.priorityCDecorationType.dispose();
		Global.priorityDDecorationType.dispose();
		Global.priorityEDecorationType.dispose();
		Global.priorityFDecorationType.dispose();
		Global.tagsDecorationType.dispose();
		Global.specialTagDecorationType.dispose();
		Global.tagsDelimiterDecorationType.dispose();
		Global.projectDecorationType.dispose();
		Global.contextDecorationType.dispose();
		Global.notDueDecorationType.dispose();
		Global.dueDecorationType.dispose();
		Global.overdueDecorationType.dispose();
		Global.invalidDueDateDecorationType.dispose();
		Global.closestDueDateDecorationType.dispose();
	}
	if (Global.changeTextDocumentDisposable) {
		Global.changeTextDocumentDisposable.dispose();
	}
}
/**
 * Update global storage value of last visit by file
 */
export async function updateLastVisitGlobalState(stringUri: string, date: Date) {
	extensionState.lastVisitByFile[stringUri] = date;
	await extensionState.extensionContext.globalState.update(LAST_VISIT_BY_FILE_STORAGE_KEY, extensionState.lastVisitByFile);
}

export function deactivate(): void {
	disposeEditorDisposables();
	Global.tagAutocompleteDisposable.dispose();
	Global.projectAutocompleteDisposable.dispose();
	Global.contextAutocompleteDisposable.dispose();
	Global.generalAutocompleteDisposable.dispose();
	Global.setDueDateAutocompleteDisposable.dispose();
	Global.changeTextDocumentDisposable.dispose();
	Global.hoverDisposable.dispose();
	Global.changeActiveTextEditorDisposable.dispose();
}
