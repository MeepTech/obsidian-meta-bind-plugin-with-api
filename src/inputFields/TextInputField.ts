import { AbstractInputField } from './AbstractInputField';
import { TextComponent } from 'obsidian';
import { MetaBindBindValueError, MetaBindInternalError } from '../utils/Utils';

export class TextInputField extends AbstractInputField {
	textComponent: TextComponent | undefined;

	getValue(): string {
		if (!this.textComponent) {
			throw new MetaBindInternalError('text input component is undefined');
		}

		return this.textComponent.getValue();
	}

	setValue(value: any): void {
		if (!this.textComponent) {
			throw new MetaBindInternalError('text input component is undefined');
		}

		if (value != null && typeof value == 'string') {
			this.textComponent.setValue(value);
		} else {
			console.warn(new MetaBindBindValueError(`invalid value \'${value}\' at textInputField ${this.inputFieldMarkdownRenderChild.uid}`));
			this.textComponent.setValue('');
		}
	}

	isEqualValue(value: any): boolean {
		return this.getValue() == value;
	}

	getDefaultValue(): any {
		return '';
	}

	getHtmlElement(): HTMLElement {
		if (!this.textComponent) {
			throw new MetaBindInternalError('text input component is undefined');
		}

		return this.textComponent.inputEl;
	}

	render(container: HTMLDivElement): void {
		console.debug(`meta-bind | render textInputField ${this.inputFieldMarkdownRenderChild.uid}`);

		const component = new TextComponent(container);
		component.setValue(this.inputFieldMarkdownRenderChild.getInitialValue());
		component.onChange(this.onValueChange);
		this.textComponent = component;
	}
}
