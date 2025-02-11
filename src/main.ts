import { CachedMetadata, editorEditorField, MarkdownPostProcessorContext, Plugin, TFile } from 'obsidian';
import { DEFAULT_SETTINGS, MetaBindPluginSettings, MetaBindSettingTab } from './settings/Settings';
import { InputFieldMarkdownRenderChild, InputFieldMarkdownRenderChildType } from './InputFieldMarkdownRenderChild';
import { getFileName, isPath, isTruthy, MetaBindBindTargetError, removeFileEnding } from './utils/Utils';
import { Logger } from './utils/Logger';
import { DateParser } from './parsers/DateParser';
import { InputFieldArgumentType, InputFieldDeclaration, InputFieldDeclarationParser, InputFieldType } from './parsers/InputFieldDeclarationParser';
import { getFrontmatterOfTFile } from '@opd-libs/opd-metadata-lib/lib/API';
import { traverseObject } from '@opd-libs/opd-metadata-lib/lib/Utils';

export default class MetaBindPlugin extends Plugin {
	// defined in `loadSettings`
	settings: MetaBindPluginSettings = null!;

	// defined in `onload`
	activeMarkdownInputFields: InputFieldMarkdownRenderChild[] = null!;
	markDownInputFieldIndex: number = null!;

	async onload(): Promise<void> {
		await this.loadSettings();

		Logger.devMode = this.settings.devMode;
		DateParser.dateFormat = this.settings.preferredDateFormat;
		InputFieldDeclarationParser.parseTemplates(this.settings.inputTemplates);

		this.activeMarkdownInputFields = [];
		this.markDownInputFieldIndex = 0;

		this.registerMarkdownPostProcessor((element, context) => {
			const codeBlocks = element.querySelectorAll('code');
			for (let index = 0; index < codeBlocks.length; index++) {
				const codeBlock = codeBlocks.item(index);
				const text = codeBlock.innerText;
				const isInputField = text.startsWith('INPUT[') && text.endsWith(']');
				if (isInputField) {
					context.addChild(this.buildInputFieldMarkdownRenderChild(text, context.sourcePath, codeBlock, InputFieldMarkdownRenderChildType.INLINE_CODE_BLOCK));
				}
			}
		});

		this.registerMarkdownCodeBlockProcessor('meta-bind', (source, el, ctx) => {
			const codeBlock = el;
			const text = source.replace(/\n/g, '');
			const isInputField = text.startsWith('INPUT[') && text.endsWith(']');
			if (isInputField) {
				ctx.addChild(this.buildInputFieldMarkdownRenderChild(text, ctx.sourcePath, codeBlock, InputFieldMarkdownRenderChildType.CODE_BLOCK));
			}
		});

		this.registerEvent(
			this.app.metadataCache.on('changed', async (file: TFile, data: string, cache: CachedMetadata) => {
				await this.updateMarkdownInputFieldsOnMetadataCacheChange(file, cache);
			})
		);

		this.addSettingTab(new MetaBindSettingTab(this.app, this));
	}

	/**
	 * Accessible function for building an input field.
	 *
	 * @param {string|InputFieldDeclaration} declaration The input field declaration as a string or object.
	 * @param {string} sourcePath The path of the file the element will be inserted into.
	 * @param {HTMLElement} container The container element for the input element.
	 * @param {InputFieldMarkdownRenderChildType} renderType Inline or Code Block.
	 *
	 * @returns The render child produced.
	 */
	buildInputFieldMarkdownRenderChild(
		declaration: string | InputFieldDeclaration,
		sourcePath: string,
		container: HTMLElement,
		renderType: InputFieldMarkdownRenderChildType = InputFieldMarkdownRenderChildType.INLINE_CODE_BLOCK
	): InputFieldMarkdownRenderChild {
		let error: string | undefined;

		try {
			if (typeof declaration === 'string') {
				declaration = InputFieldDeclarationParser.parseString(declaration);
			} else {
				declaration = InputFieldDeclarationParser.parseDeclaration(declaration);
			}
		} catch (e: any) {
			if (e instanceof Error) {
				error = e.message;
				console.warn(e);
			}
		}

		return new InputFieldMarkdownRenderChild(container, renderType, declaration as InputFieldDeclaration, this, sourcePath, error);
	}

	/**
	 * Helper method to build a declaration from some initial data or a string.
	 *
	 * @param {string | InputFieldDeclaration | {}} declarationData The base declaration data or a string to parse for it. Can also be an empty object with the other arguments provided to fill it.
	 * @param {Record<InputFieldArgumentType, string> | {} | undefined} inputFieldArguments (Optional) The input field arguments, indexed by argument name.
	 * @param {InputFieldType | undefined} inputFieldType (Optional) The input field type if not provided in the base object.
	 * @param {boolean | undefined} isBound (Optional) If the field should try to be bound to a bindTarget.
	 * @param {string | undefined} bindTarget (Optional) The bind target of the field.
	 * @param {string | undefined} templateName (Optional) A template to use.
	 *
	 * @returns A constructed InputFieldDeclaration.
	 */
	buildDeclaration(
		declarationData: string | InputFieldDeclaration | {},
		inputFieldArguments?: Record<InputFieldArgumentType, string> | {},
		inputFieldType?: InputFieldType,
		isBound?: boolean,
		bindTarget?: string,
		templateName?: string
	): InputFieldDeclaration {
		if (typeof declarationData === 'string') {
			return InputFieldDeclarationParser.parseString(declarationData);
		} else {
			const declarationBase = declarationData as InputFieldDeclaration;
			declarationBase.inputFieldType = inputFieldType ?? declarationBase.inputFieldType ?? InputFieldType.INVALID;
			declarationBase.isBound = isBound ?? declarationBase.isBound ?? false;
			declarationBase.bindTarget = bindTarget ?? declarationBase.bindTarget ?? undefined;

			// if the input field is bound should be determined by `isBound`
			// `isBound` is true, `bindTarget` must be set
			if (declarationBase.isBound && !declarationBase.bindTarget) {
				throw new MetaBindBindTargetError('input field declaration is bound but bind target is undefined');
			}

			return InputFieldDeclarationParser.parseDeclaration(declarationBase, inputFieldArguments, templateName);
		}
	}

	onunload(): void {
		for (const activeMarkdownInputField of this.activeMarkdownInputFields) {
			activeMarkdownInputField.unload();
		}
	}

	registerInputFieldMarkdownRenderChild(inputFieldMarkdownRenderChild: InputFieldMarkdownRenderChild): void {
		console.debug(`meta-bind | registered input field ${inputFieldMarkdownRenderChild.uid}`);
		this.activeMarkdownInputFields.push(inputFieldMarkdownRenderChild);
	}

	unregisterInputFieldMarkdownRenderChild(inputFieldMarkdownRenderChild: InputFieldMarkdownRenderChild): void {
		console.debug(`meta-bind | unregistered input field ${inputFieldMarkdownRenderChild.uid}`);
		this.activeMarkdownInputFields = this.activeMarkdownInputFields.filter(x => x.uid !== inputFieldMarkdownRenderChild.uid);
	}

	updateMarkdownInputFieldsOnMetadataCacheChange(file: TFile, cache: CachedMetadata): void {
		let metadata: any = undefined;

		for (const activeMarkdownInputField of this.activeMarkdownInputFields) {
			if (!activeMarkdownInputField.inputFieldDeclaration?.isBound || !activeMarkdownInputField.bindTargetFile || !activeMarkdownInputField.bindTargetMetadataField) {
				continue;
			}

			if (activeMarkdownInputField.bindTargetFile.path === file.path) {
				if (metadata === undefined) {
					metadata = getFrontmatterOfTFile(file, this);
				}
				activeMarkdownInputField.pushToInputFieldValueUpdateQueue(traverseObject(activeMarkdownInputField.bindTargetMetadataField, metadata));
			}
		}
	}

	getFilesByName(name: string): TFile[] {
		console.log(getFileName(removeFileEnding(name)));
		const fileNameIsPath = isPath(name);
		const processedFileName = fileNameIsPath ? removeFileEnding(name) : getFileName(removeFileEnding(name));

		const allFiles = this.app.vault.getMarkdownFiles();
		const files: TFile[] = [];
		for (const file of allFiles) {
			// console.log(removeFileEnding(file.path));
			if (fileNameIsPath) {
				if (removeFileEnding(file.path) === processedFileName) {
					files.push(file);
				}
			} else {
				if (getFileName(removeFileEnding(file.name)) === processedFileName) {
					files.push(file);
				}
			}
		}

		return files;
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		DateParser.dateFormat = this.settings.preferredDateFormat;
		Logger.devMode = this.settings.devMode;
		InputFieldDeclarationParser.parseTemplates(this.settings.inputTemplates);
		await this.saveData(this.settings);
	}
}
