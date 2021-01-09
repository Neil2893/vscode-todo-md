import dayjs from 'dayjs';
import vscode, { TextDocument, TextLine, Uri, WorkspaceEdit } from 'vscode';
import { applyEdit, updateArchivedTasks } from './commands';
import { DueDate } from './dueDate';
import { extensionConfig, state } from './extension';
import { parseDocument } from './parse';
import { findTaskAtLineExtension } from './taskUtils';
import { Count, TheTask } from './TheTask';
import { DATE_FORMAT, getDateInISOFormat } from './time/timeUtils';
import { DueState } from './types';

export async function hideTask(document: vscode.TextDocument, lineNumber: number) {
	const wEdit = new WorkspaceEdit();
	const line = document.lineAt(lineNumber);
	wEdit.insert(document.uri, line.range.end, ' {h}');
	return applyEdit(wEdit, document);
}

export async function toggleTaskCollapse(document: vscode.TextDocument, lineNumber: number) {
	const wEdit = new WorkspaceEdit();
	const line = document.lineAt(lineNumber);
	const task = findTaskAtLineExtension(lineNumber);
	if (task?.collapseRange) {
		wEdit.delete(document.uri, task.collapseRange);
	} else {
		wEdit.insert(document.uri, line.range.end, ' {c}');
	}
	return applyEdit(wEdit, document);
}

export async function setDueDate(document: vscode.TextDocument, lineNumber: number, newDueDate: string) {
	const dueDate = `{due:${newDueDate}}`;
	const wEdit = new WorkspaceEdit();
	const task = findTaskAtLineExtension(lineNumber);
	if (task?.dueRange) {
		wEdit.replace(document.uri, task.dueRange, dueDate);
	} else {
		const line = document.lineAt(lineNumber);
		const isLineEndsWithWhitespace = line.text.endsWith(' ');
		wEdit.insert(document.uri, line.range.end, `${isLineEndsWithWhitespace ? '' : ' '}${dueDate}`);
	}
	return await applyEdit(wEdit, document);
}

export async function tryToDeleteTask(document: vscode.TextDocument, lineNumber: number) {
	const task = findTaskAtLineExtension(lineNumber);
	if (!task) {
		return undefined;
	}
	const edit = new WorkspaceEdit();

	let willDeleteMultipleTasks = '';
	let showConfirmationDialog = false;

	const taskLineNumbersToDelete = [lineNumber];
	if (task.subtasks.length) {
		taskLineNumbersToDelete.push(...task.getNestedTasksIds());
		willDeleteMultipleTasks = `\n ❗ [ ${task.subtasks.length + 1} ] tasks will be deleted.`;
	}

	if (extensionConfig.confirmTaskDelete === 'always') {
		showConfirmationDialog = true;
	} else if (extensionConfig.confirmTaskDelete === 'hasNestedTasks') {
		if (task.subtasks.length) {
			showConfirmationDialog = true;
		}
	}

	if (showConfirmationDialog) {
		const confirmBtnName = 'Delete';
		const button = await vscode.window.showWarningMessage(`Confirm deletion?${willDeleteMultipleTasks}`, {
			modal: true,
		}, confirmBtnName);
		if (button !== confirmBtnName) {
			return undefined;
		}
	}

	for (const ln of taskLineNumbersToDelete) {
		deleteTaskWorkspaceEdit(edit, document, ln);
	}

	return applyEdit(edit, document);
}

export function deleteTaskWorkspaceEdit(wEdit: WorkspaceEdit, document: vscode.TextDocument, lineNumber: number) {
	wEdit.delete(document.uri, document.lineAt(lineNumber).rangeIncludingLineBreak);
}
/**
 * Either toggle done or increment count
 */
export async function toggleDoneOrIncrementCount(document: vscode.TextDocument, lineNumber: number) {
	const task = findTaskAtLineExtension(lineNumber);
	if (!task) {
		return undefined;
	}
	if (task.count) {
		return await incrementCountForTask(document, lineNumber, task);
	} else {
		await toggleDoneAtLine(document, lineNumber);
		return undefined;
	}
}
export async function incrementCountForTask(document: vscode.TextDocument, lineNumber: number, task: TheTask) {
	const line = document.lineAt(lineNumber);
	const wEdit = new WorkspaceEdit();
	const count = task.count;
	if (!count) {
		return Promise.resolve(undefined);
	}
	let newValue = 0;
	if (count.current !== count.needed) {
		newValue = count.current + 1;
		if (newValue === count.needed) {
			insertCompletionDateEdit(wEdit, document.uri, line);
			removeOverdueEdit(wEdit, document.uri, task);
		}
		setCountCurrentValueEdit(wEdit, document.uri, count, String(newValue));
	} else {
		setCountCurrentValueEdit(wEdit, document.uri, count, '0');
		removeCompletionDateWorkspaceEdit(wEdit, document.uri, line);
	}
	return applyEdit(wEdit, document);
}
export async function decrementCountForTask(document: vscode.TextDocument, lineNumber: number, task: TheTask) {
	const line = document.lineAt(lineNumber);
	const wEdit = new WorkspaceEdit();
	const count = task.count;
	if (!count) {
		return Promise.resolve(undefined);
	}
	if (count.current === 0) {
		return Promise.resolve(undefined);
	} else if (count.current === count.needed) {
		removeCompletionDateWorkspaceEdit(wEdit, document.uri, line);
	}
	setCountCurrentValueEdit(wEdit, document.uri, count, String(count.current - 1));
	return applyEdit(wEdit, document);
}
export async function incrementOrDecrementPriority(document: TextDocument, lineNumber: number, type: 'decrement' | 'increment') {
	const task = findTaskAtLineExtension(lineNumber);
	if (!task ||
			type === 'increment' && task.priority === 'A' ||
			type === 'decrement' && task.priority === 'Z') {
		return undefined;
	}
	const newPriority = type === 'increment' ? String.fromCharCode(task.priority.charCodeAt(0) - 1) : String.fromCharCode(task.priority.charCodeAt(0) + 1);
	const wEdit = new WorkspaceEdit();
	if (task.priorityRange) {
		// Task has priority
		wEdit.replace(document.uri, task.priorityRange, `(${newPriority})`);
	} else {
		// No priority, create one
		wEdit.insert(document.uri, new vscode.Position(lineNumber, 0), `(${newPriority}) `);
	}
	return applyEdit(wEdit, document);
}
function removeOverdueEdit(edit: WorkspaceEdit, uri: Uri, task: TheTask) {
	if (task.overdueRange) {
		edit.delete(uri, task.overdueRange);
	}
}
export function insertCompletionDateEdit(wEdit: WorkspaceEdit, uri: Uri, line: TextLine) {
	wEdit.insert(uri, new vscode.Position(line.lineNumber, line.range.end.character), ` {cm:${getDateInISOFormat(new Date(), extensionConfig.completionDateIncludeTime)}}`);
}
export function removeDoneSymbolEdit(wEdit: WorkspaceEdit, uri: Uri, line: vscode.TextLine) {
	if (line.text.trim().startsWith(extensionConfig.doneSymbol)) {
		wEdit.delete(uri, new vscode.Range(line.lineNumber, line.firstNonWhitespaceCharacterIndex, line.lineNumber, line.firstNonWhitespaceCharacterIndex + extensionConfig.doneSymbol.length));
	}
}
async function removeOverdueFromLine(document: vscode.TextDocument, task: TheTask) {
	const edit = new WorkspaceEdit();
	removeOverdueEdit(edit, document.uri, task);
	return applyEdit(edit, document);
}
export async function toggleDoneAtLine(document: TextDocument, lineNumber: number) {
	const { firstNonWhitespaceCharacterIndex } = document.lineAt(lineNumber);
	const task = findTaskAtLineExtension(lineNumber);
	if (!task) {
		return;
	}
	if (task.overdue) {
		await removeOverdueFromLine(document, task);
	}
	const line = document.lineAt(lineNumber);
	const wEdit = new WorkspaceEdit();
	if (task.done) {
		if (!extensionConfig.addCompletionDate) {
			if (line.text.trim().startsWith(extensionConfig.doneSymbol)) {
				wEdit.delete(document.uri, new vscode.Range(lineNumber, firstNonWhitespaceCharacterIndex, lineNumber, firstNonWhitespaceCharacterIndex + extensionConfig.doneSymbol.length));
			}
		} else {
			removeCompletionDateWorkspaceEdit(wEdit, document.uri, line);
		}
	} else {
		if (extensionConfig.addCompletionDate) {
			insertCompletionDateEdit(wEdit, document.uri, line);
		} else {
			wEdit.insert(document.uri, new vscode.Position(lineNumber, firstNonWhitespaceCharacterIndex), extensionConfig.doneSymbol);
		}
	}
	await applyEdit(wEdit, document);

	if (extensionConfig.autoArchiveTasks) {
		const secondWorkspaceEdit = new WorkspaceEdit();
		archiveTaskWorkspaceEdit(secondWorkspaceEdit, document.uri, line, !task.due?.isRecurring);
		await applyEdit(secondWorkspaceEdit, document);// Not possible to apply conflicting ranges with just one edit
	}
}
export function removeCompletionDateWorkspaceEdit(wEdit: WorkspaceEdit, uri: vscode.Uri, line: vscode.TextLine) {
	const completionDateRegex = /\s{cm:\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?}\s?/;
	const match = completionDateRegex.exec(line.text);
	if (match) {
		wEdit.delete(uri, new vscode.Range(line.lineNumber, match.index, line.lineNumber, match.index + match[0].length));
	}
}
export function archiveTaskWorkspaceEdit(wEdit: WorkspaceEdit, uri: vscode.Uri, line: vscode.TextLine, shouldDelete: boolean) {
	appendTaskToFile(line.text, extensionConfig.defaultArchiveFile);
	if (shouldDelete) {
		wEdit.delete(uri, line.rangeIncludingLineBreak);
	}
	updateArchivedTasks();
}
function addOverdueSpecialTagWorkspaceEdit(wEdit: WorkspaceEdit, uri: vscode.Uri, line: vscode.TextLine, overdueDateString: string) {
	wEdit.insert(uri, new vscode.Position(line.lineNumber, line.range.end.character), ` {overdue:${overdueDateString}}`);
}
export function setCountCurrentValueEdit(wEdit: WorkspaceEdit, uri: Uri, count: Count, value: string) {
	const charIndexWithOffset = count.range.start.character + 'count:'.length + 1;
	const currentRange = new vscode.Range(count.range.start.line, charIndexWithOffset, count.range.start.line, charIndexWithOffset + String(count.current).length);
	wEdit.replace(uri, currentRange, String(value));
}

export async function goToTask(lineNumber: number) {
	const document = await getActiveDocument();
	const editor = await vscode.window.showTextDocument(document);
	const range = new vscode.Range(lineNumber, 0, lineNumber, 0);
	editor.selection = new vscode.Selection(range.start, range.end);
	editor.revealRange(range, vscode.TextEditorRevealType.Default);
	// Highlight for a short time revealed range
	const lineHighlightDecorationType = vscode.window.createTextEditorDecorationType({
		backgroundColor: '#ffa30468',
		isWholeLine: true,
	});
	editor.setDecorations(lineHighlightDecorationType, [range]);
	setTimeout(() => {
		editor.setDecorations(lineHighlightDecorationType, []);
	}, 700);
}

export async function resetAllRecurringTasks(document: vscode.TextDocument, lastVisit: Date | string = new Date()) {
	if (typeof lastVisit === 'string') {
		lastVisit = new Date(lastVisit);
	}
	const wEdit = new WorkspaceEdit();
	const tasks = (await parseDocument(document)).tasks;
	for (const task of tasks) {
		if (task.due?.isRecurring) {
			const line = document.lineAt(task.lineNumber);
			if (task.done) {
				removeDoneSymbolEdit(wEdit, document.uri, line);
				removeCompletionDateWorkspaceEdit(wEdit, document.uri, line);
			} else {
				if (!task.overdue && !dayjs().isSame(lastVisit, 'day')) {
					const lastVisitWithoutTime = new Date(lastVisit.getFullYear(), lastVisit.getMonth(), lastVisit.getDate());
					const now = new Date();
					const nowWithoutTime = new Date(now.getFullYear(), now.getMonth(), now.getDate());
					const daysSinceLastVisit = dayjs(nowWithoutTime).diff(lastVisitWithoutTime, 'day');
					for (let i = daysSinceLastVisit; i > 0; i--) {
						const date = dayjs().subtract(i, 'day');
						const res = new DueDate(task.due.raw, {
							targetDate: date.toDate(),
						});
						if (res.isDue === DueState.due || res.isDue === DueState.overdue) {
							addOverdueSpecialTagWorkspaceEdit(wEdit, document.uri, line, date.format(DATE_FORMAT));
							break;
						}
					}
				}
			}

			const count = task.count;
			if (count) {
				setCountCurrentValueEdit(wEdit, document.uri, count, '0');
			}
		}
	}
	return applyEdit(wEdit, document);
}

export async function getActiveDocument() {
	if (state.activeDocument === undefined) {
		vscode.window.showErrorMessage('No active document');
		throw new Error('No active document');
	}
	if (state.activeDocument.isClosed) {
		state.activeDocument = await vscode.workspace.openTextDocument(state.activeDocument.uri);
	}
	return state.activeDocument;
}

export async function getDocumentForDefaultFile() {
	if (!extensionConfig.defaultFile) {
		return undefined;
	}
	return await vscode.workspace.openTextDocument(vscode.Uri.file(extensionConfig.defaultFile));
}
export async function appendTaskToFile(text: string, filePath: string) {
	const uri = vscode.Uri.file(filePath);
	const document = await vscode.workspace.openTextDocument(uri);
	const wEdit = new WorkspaceEdit();
	const eofPosition = document.lineAt(document.lineCount - 1).rangeIncludingLineBreak.end;
	wEdit.insert(uri, eofPosition, `\n${text}`);
	return applyEdit(wEdit, document);
}
export function toggleCommentAtLineWorkspaceEdit(wEdit: WorkspaceEdit, document: TextDocument, lineNumber: number) {
	const line = document.lineAt(lineNumber);
	if (line.text.startsWith('# ')) {
		wEdit.delete(document.uri, new vscode.Range(lineNumber, 0, lineNumber, 2));
	} else {
		wEdit.insert(document.uri, new vscode.Position(lineNumber, 0), '# ');
	}
}
