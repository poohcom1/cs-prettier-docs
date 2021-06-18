const vscode = require("vscode")
const JSDOM = require("jsdom");

// Debugging print
const debug = vscode.window.createOutputChannel("CS Prettier Debug");
const DEBUG_MODE = false;

function print(message) {
	if (!DEBUG_MODE) return;

	debug.appendLine(message);
}

// Get the config
let config = vscode.workspace.getConfiguration("csPrettierDoc");

// For disabling with the toggle command
let enabled = true;

function activate(context) {
	const getActiveEditor = () => vscode.window.activeTextEditor;

	// When switching documents
	vscode.window.onDidChangeActiveTextEditor(editor => {
		if (!enabled) {
			editor.setDecorations(decorationType, [])
			return
		};

		decorate(editor);
	})

	// When moving the cursor and highlighting
	vscode.window.onDidChangeTextEditorSelection(editor => {
		if (!enabled) {
			editor.setDecorations(decorationType, [])
			return
		};

		decorate(getActiveEditor());
	})

	// When editing text
	vscode.workspace.onDidChangeTextDocument((event) => {
		const openEditor = vscode.window.visibleTextEditors.filter(
			(editor) => editor.document.uri === event.document.uri
		)[0];

		decorate(openEditor);
	});

	// When configurations updated
	vscode.workspace.onDidChangeConfiguration(() => {
		config = vscode.workspace.getConfiguration("csPrettierDoc");

		decorate(getActiveEditor());
	})

	// Add toggle command
	context.subscriptions.push(
		vscode.commands.registerCommand("csPrettierDoc.toggle", () => {
			enabled = !enabled;

			if (!enabled) {
				getActiveEditor().setDecorations(decorationType, []) // Remove decorations
			} else {
				decorate(getActiveEditor())
			}

			print(enabled)
		})
	)

	decorate(getActiveEditor());
}


/**
 * Decorates the C# docs in the given editors
 * @param {vscode.TextEditor} editor 
 */
function decorate(editor) {
	let sourceCode = editor.document.getText();

	if (!sourceCode || sourceCode === "") return;

	const sourceCodeArr = sourceCode.split("\n");

	// Get cursor position
	let cursorPosition = null;
	if (editor && editor.selection.isEmpty) {
		cursorPosition = editor.selection.active;
	}

	let decorationsArray = [];

	decorateSourceCode(sourceCodeArr, decorationsArray, cursorPosition.line);

	editor.setDecorations(decorationType, decorationsArray);
}

/**
 * Scans the lines of source code and fills up the decorationsArray with the appropriate decoration options
 * @param {string[]} sourceCodeArr Array of lines of the source code
 * @param {vscode.DecorationOptions[]} decorationsArray Array of vscode Decoration Options
 * @param {number} cursorLine Position of the cursor
 */
function decorateSourceCode(sourceCodeArr, decorationsArray, cursorLine = null) {
	const dom = new JSDOM.JSDOM("");
	const DOMParser = dom.window.DOMParser;
	const parser = new DOMParser;

	// For lines beginning with triple backslashes
	const commentRegex = /(?<=\/\/\/ +)(.*)/
	// For summary tag
	const summaryReg = /(< *summary)/
	// For summary ending tag
	const summaryEndReg = /(<\/summary)/
	// For param tag
	const paramReg = /(< *param)/
	// For return tag
	const returnReg = /(< *returns)/

	// String for the comment xml
	let docXml = "";

	// Line numbers for the tags
	let summaryLine = -1;
	let summaryEndLine = -1;
	let paramLines = [];
	let returnLine = -1;

	// Use to skip the current doc xml chunk when a cursor is found
	let skipCurrent = false;

	// The amount of indent for the doc xml chunk
	let indent = 0


	// Loop through entire code
	for (let line = 0; line < sourceCodeArr.length; line++) {
		const currentLine = sourceCodeArr[line]
		const match = currentLine.match(commentRegex); // Match triple backslash comments

		// If there's a match for comment, add comment to docXml and store other values
		if (match) {
			//print(match[0])
			docXml += match[0]; // Add comment (without the triple backslash) to the docXml string

			indent = currentLine.match(/(\/\/\/)/).index; // Set indent based on index of the triple backslash

			// Store index of tag lines
			if (currentLine.match(summaryReg))
				summaryLine = line;
			else if (currentLine.match(summaryEndReg))
				summaryEndLine = line;
			else if (currentLine.match(paramReg))
				paramLines.push(line)
			else if (currentLine.match(returnReg))
				returnLine = line;

			// If cursor is within line,  raise skipCurrent flag to skip the decoration
			if (cursorLine === line) skipCurrent = true;

		} else if (docXml !== "") {
			// If there's no match and docXml has values, xml chunk end has been reached

			// Attempt to parse the XML
			try {
				// Throw error to skip if skipCurrent flag is raised due
				if (skipCurrent) throw new Error;

				const document = parser.parseFromString("<root>" + docXml + "</root>", "text/xml");

				// Parse document for rags
				const summaryElements = document.getElementsByTagName("summary")
				const paramElements = document.getElementsByTagName("param")
				const returnElements = document.getElementsByTagName("returns")

				if (summaryLine !== -1 && summaryElements[0]) {
					const summaryText = summaryElements[0].textContent;

					// Clear the lines until the last line
					decorationsArray.push({
						range: new vscode.Range(
							new vscode.Position(summaryLine + 0, 0),
							new vscode.Position(summaryEndLine, 0)
						)
					})

					decorationsArray.push(getSummaryDecorator(config.get("summaryPrefix") + summaryText + config.get("summarySuffix"), new vscode.Range(
						new vscode.Position(summaryEndLine, indent),
						new vscode.Position(summaryEndLine + 1, 0)
					)))
				}

				paramLines.forEach((l, i) => {
					const paramElement = paramElements[i];

					if (!paramElement) return;

					let paramText = config.get("paramPrefix") + paramElement.getAttribute("name");

					if (paramElement.textContent !== "") {
						paramText += config.get("paramDelimiter") + paramElement.textContent + config.get("paramSuffix");
					}

					decorationsArray.push(getDecorator(paramText, new vscode.Range(
						new vscode.Position(l, indent),
						new vscode.Position(l + 1, 0)
					), new vscode.ThemeColor("csPrettierDoc.param"), 500, "normal"))
				})

				if (returnLine !== -1 && returnElements[0]) {
					const returnText = config.get("returnPrefix") + returnElements[0].textContent + config.get("returnSuffix");

					decorationsArray.push(getDecorator(returnText, new vscode.Range(
						new vscode.Position(returnLine, indent),
						new vscode.Position(returnLine + 1, 0)
					), new vscode.ThemeColor("csPrettierDoc.return")))
				}
			} catch (err) {
				console.log(err)
			} finally {
				// Reset values
				docXml = ""
				paramLines = []
			}

		} else {
			// If no match is found, no need to skip because the cursor can't possibly be on an XML doc
			skipCurrent = false;
		}
	}
}

/**
 * Decorator for the actual comments to hide them
 */
const decorationType = vscode.window.createTextEditorDecorationType({
	opacity: `${config.get("opacity")}`,
});


/**
 * Generates the decorator for summaries
 * @param {string} message 
 * @param {vscode.Range} range 
 * @returns 
 */
function getSummaryDecorator(message, range) {
	return {
		range,
		renderOptions: {
			before: {
				opacity: "1.0",
				color: new vscode.ThemeColor("csPrettierDoc.summary"),
				contentText: message,
				backgroundColor: new vscode.ThemeColor("csPrettierDoc.background"),
				margin: `0px 3px 0px 3px;padding: ${config.get("verticalPadding")}px ${config.get(
					"horizontalPadding"
				)}px;`,
				borderRadius: `${config.get("borderRadius")}px`,
				fontWeight: 500 + `; font- size: ${config.get("fontSize") + 2} px;`,
				fontStyle: "normal"
			},
		},
	};
}

/**
 * Generates the decorator for params and returns
 * @param {string} message
 * @param {vscode.Range} range
 * @returns
 */
function getDecorator(message, range, color = "#449944",
	weight = `${config.get("fontWeight")}`,
	style = `${config.get("fontStyle")}`,
	fontSize = `${config.get("fontSize")}`) {
	return {
		range,
		renderOptions: {
			before: {
				opacity: "0.9",
				color: color,
				contentText: message,
				backgroundColor: new vscode.ThemeColor("csPrettierDoc.hintBackground"),
				margin: `0px 3px 0px 3px;padding: ${config.get("verticalPadding")}px ${config.get(
					"horizontalPadding"
				)}px;`,
				borderRadius: `${config.get("borderRadius")}px`,
				fontWeight: weight + `; font- size: ${fontSize} px;`,
				fontStyle: style
			},
		},
	};
}



// this method is called when your extension is deactivated
function deactivate() { }

module.exports = {
	activate,
	deactivate,
	decorationType,
	getSummaryDecorator,
	getDecorator,
	decorateSourceCode
}
