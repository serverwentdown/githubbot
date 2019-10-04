const { env } = Deno;
import { Response, ServerRequest, listenAndServe } from "https://deno.land/std/http/server.ts";
import { hmac } from "https://deno.land/x/hmac/mod.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const TELEGRAM_API_BASE_URL = "https://api.telegram.org/bot";

type Options = {
	telegramToken: string,
	telegramSecret: string,
	secret: string,
	baseURL: string,
	listen: string,
};

type Params = {
	silent: boolean,
};

type GitHubUser = {
	login: string,
	avatar_url: string,
	html_url: string,
};

type GitHubRepository = {
	name: string,
	full_name: string,
	private: boolean,
	owner: GitHubUser,
	html_url: string,
	branches_url: string,
	url: string,
};

type GitHubCommit = {
	id: string,
	message: string,
	timestamp: string,
	url: string,
	author: GitHubCommitAuthor,
	added: string[],
	removed: string[],
	modified: string[],
};

type GitHubCommitAuthor = {
	name: string,
	email: string,
	username: string,
};

type GitHubEventPing = {
	zen: string,
	hook_id: number,
	hook: object,
};

type GitHubEventPush = {
	ref: string,
	sender: GitHubUser,
	repository: GitHubRepository,
	commits: GitHubCommit[],
	compare: string,
	forced: boolean,
};

const githubEventFormatters = {
	'ping': (ping: GitHubEventPing): string => {
		return `You successfully set up GitHub notifications.
GitHub Zen: ${ping.zen}`;
	},
	'push': (push: GitHubEventPush): string => {
		const branch = push.ref.replace('refs/heads/', '');
		return `[${push.sender.login}](${push.sender.html_url}): 
[${push.commits.length} new commit${push.commits.length == 1 ? "" : "s"}](${push.compare}) ${push.forced ? "force-" : ""}pushed to [\`${branch}\`](${push.repository.branches_url.replace('{/branch}', '/' + branch)})
${push.commits.map(commit => `\`${commit.id.slice(0, 7)}\` ${commit.message} - ${commit.author.username}`).join('\n')}
[_${push.repository.full_name}_](${push.repository.html_url})`;
	},
};

type TelegramUpdate = {
	update_id: number,
	message?: TelegramMessage,
	callback_query?: TelegramCallbackQuery,
};

type TelegramMessage = {
	message_id: number,
	from?: TelegramUser,
	date: number,
	chat: TelegramChat,
	text?: string,
	entities?: TelegramMessageEntity[],
};

type TelegramUser = {
	id: number,
	is_bot: boolean,
	first_name: string,
	last_name?: string,
	username?: string,
	language_code?: string,
};

type TelegramChat = {
	id: number,
	type: string,
	title?: string,
	username?: string,
	first_name?: string,
	last_name?: string,
};

type TelegramMessageEntity = {
	type: string,
	offset: number,
	length: number,
};

type TelegramCallbackQuery = {
	id: number,
	message?: TelegramMessage,
	data?: string,
};

type TelegramActionSendMessage = {
	chat_id?: string | number,
	text: string,
	parse_mode?: string,
	disable_web_page_preview?: boolean,
	disable_notification?: boolean,
	reply_markup?: TelegramInlineKeyboardMarkup,
};

type TelegramInlineKeyboardMarkup = {
	inline_keyboard: TelegramInlineKeyboardButton[][],
};

type TelegramInlineKeyboardButton = {
	text: string,
	callback_data?: string,
};

class GitHubBot {

	private options: Options;

	constructor(options: Options) {
		this.options = options;
	}

	public async setup(): Promise<void> {
		await this.setupTelegramWebhook();
	}

	safeHMAC(data: string): string {
		const hash = hmac("sha1", this.options.secret, data, "utf8", "base64");
		return hash.toString().replace("+", "-").replace("/", "_").replace("=", "");
	}

	public generateWebhookURL(chatID: number): string {
		const chatToken = this.safeHMAC(`${chatID}`);
		return `${this.options.baseURL}/github/${chatID}/${chatToken}`;
	}
	
	public verifyWebhookURL(chatID: number, chatToken: string): boolean {
		return this.safeHMAC(`${chatID}`) === chatToken;
	}

	public async githubEvent(chatID: number, chatToken: string, params: Params, event: string, data: object): Promise<object> {
		//console.debug("githubEvent", chatID, chatToken, JSON.stringify(data));
		if (!this.verifyWebhookURL(chatID, chatToken)) {
			throw new Error("invalid: chatToken");
		}

		const message: TelegramActionSendMessage = this.formatEventMessage(event, data);
		await this.telegramApi("sendMessage", {
			chat_id: chatID,
			disable_notification: params.silent,
			...message,
		});

		return {};
	}

	public async telegramUpdate(telegramSecret: string, data: TelegramUpdate): Promise<object> {
		//console.debug("telegramUpdate", telegramSecret, JSON.stringify(data.message));
		if (telegramSecret !== this.options.telegramSecret) {
			throw new Error("invalid: telegramSecret");
		}

		if (data.message) {

			// Probably a command
			const message: TelegramMessage = data.message;

			const entities: TelegramMessageEntity[] = message.entities;
			if (!entities || entities.length < 1) {
				console.warn(`ignored: No entities found in Telegram message: ${message}`);
				return;
			}

			// Assume encoding is UTF-8, not UTF-16 as stated in https://core.telegram.org/bots/api#messageentity
			const firstEntity = message.text.slice(entities[0].offset, entities[0].offset + entities[0].length);
			const command = firstEntity.split("@")[0];

			if (command == "/setup") {
				return {
					method: "sendMessage",
					chat_id: message.chat.id,
					...this.formatSetupMessage(message.chat.id),
					reply_markup: {
						inline_keyboard: [[{
							text: "Advanced Setup",
							callback_data: "updateMessageSetupAdvanced",
						}]],
					},
				};
			}

			return {
				method: "sendMessage",
				chat_id: message.chat.id,
				...this.formatUnknownCommandMessage(command),
			};

		}
		if (data.callback_query) {
			
			// Callback query
			const callback_query: TelegramCallbackQuery = data.callback_query;

			if (!callback_query.message || !callback_query.data) {
				console.warn(`ignored: Callback query mode is not known`);
				return;
			}
	
			const message: TelegramMessage = callback_query.message;
			const action = callback_query.data;

			if (action == "updateMessageSetupAdvanced") {
				await this.updateMessageSetupAdvanced(message);
			}

			return {
				method: "answerCallbackQuery",
			};

		}

		console.warn(`ignored: Unknown Telegram update received: ${data}`);
		return;

	}

	async updateMessageSetupAdvanced(message: TelegramMessage) {
		await this.telegramApi("editMessageText", {
			chat_id: message.chat.id,
			message_id: message.message_id,
			...this.formatSetupAdvancedMessage(message.chat.id),
		});
	}
	
	formatEventMessage(event: string, data: object): TelegramActionSendMessage {
		if (!(event in githubEventFormatters)) {
			throw new Error(`invalid: Event type "${event}" is not known`);
		}
		const text = githubEventFormatters[event](data);
		return {
			parse_mode: "Markdown",
			text,
			disable_web_page_preview: true,
		};
	}

	formatSetupMessage(chatID: number): TelegramActionSendMessage {
		const url = this.generateWebhookURL(chatID);
		return {
			parse_mode: "Markdown",
			text: `*Steps*

1. Open "Settings" → "Webhooks" → "Add Webhook" in your GitHub repository.
2. Paste the following URL as "Payload URL":
${url}
3. Under "Content-Type", choose "application/json"

Press "Add webhook" and you're done. You can optionally choose specific events to send a message for.`,
			disable_web_page_preview: true,
		};
	}

	formatSetupAdvancedMessage(chatID: number): TelegramActionSendMessage {
		const { text }: TelegramActionSendMessage = this.formatSetupMessage(chatID);
		return {
			parse_mode: "Markdown",
			text: text + `

*Advanced Flags*

Pass these flags as query parameters. For example: <url>?silent

• \`silent\` - Makes events silent

`,
			disable_web_page_preview: true,
		};
	}

	formatUnknownCommandMessage(command: string): TelegramActionSendMessage {
		return {
			text: `Oops, I don't understand your command ${command}`,
		};
	}

	async setupTelegramWebhook(): Promise<void> {
		console.info("Setting up webhook...");
		await this.telegramApi("setWebhook", {
			url: `${this.options.baseURL}/telegramUpdate/${this.options.telegramSecret}`,
		});
		console.log("Webhook ready");
	}

	async telegramApi(action: string, data: object): Promise<object> {
		const method = "POST";
		const url = `${TELEGRAM_API_BASE_URL}${this.options.telegramToken}/${action}`;
		const body = JSON.stringify(data);
		const res = await fetch(url, {
			method,
			headers: [
				["Content-Type", "application/json"],
			],
			body,
		});
		if (!res.ok) {
			let err = await res.text();
			throw new Error(`Failure to perform API request: ${err}`);
		}
		const obj = await res.json();
		return obj;
	}

}

async function serveGitHubWebhook(req: ServerRequest, bot: GitHubBot, parts: [string, string], urlParams: URLSearchParams): Promise<Response> {
	const chatID = parseInt(parts[0], 10);
	const chatToken = parts[1];
	const params: Params = {
		silent: urlParams.has("silent"),
	};

	const body = await req.body();
	const data = JSON.parse(decoder.decode(body));
	const event = req.headers.get("X-GitHub-Event");
	const reply = await bot.githubEvent(chatID, chatToken, params, event, data);
	return respondIfReply(reply);
}

async function serveTelegramWebhook(req: ServerRequest, bot: GitHubBot, parts: [string], params: URLSearchParams): Promise<Response> {
	const telegramSecret = parts[0];

	const body = await req.body();
	const data = JSON.parse(decoder.decode(body));
	const reply = await bot.telegramUpdate(telegramSecret, data);
	return respondIfReply(reply);
}

async function respondIfReply(reply?: object): Promise<Response> {
	if (reply) {
		const headers = new Headers();
		headers.set("Content-Type", "application/json");
		return {
			status: 200,
			headers,
			body: encoder.encode(JSON.stringify(reply)),
		};
	}
	return {
		status: 200,
		body: encoder.encode("Success"),
	};
}

async function serveBadRequest(): Promise<Response> {
	return {
		status: 400,
		body: encoder.encode("Bad Request"),
	};
}

async function serveNotFound(): Promise<Response> {
	return {
		status: 404,
		body: encoder.encode("Not Found"),
	};
}

async function serveMethodNotAllowed(): Promise<Response> {
	return {
		status: 405,
		body: encoder.encode("Method Not Allowed"),
	};
}

async function serveInternalServerError(): Promise<Response> {
	return {
		status: 500,
		body: encoder.encode("Unknown Internal Server Error"),
	};
}

async function route(req: ServerRequest, bot: GitHubBot): Promise<Response> {
	const url = new URL(req.url, "https://localhost"); // Need a better URL parser
	const params = url.searchParams;
	const parts = url.pathname.split("/").filter(part => part);
	if (parts.length === 2) {
		if (req.method !== "POST") {
			return await serveMethodNotAllowed();
		}
		if (parts[0] === "telegramUpdate") {
			return await serveTelegramWebhook(req, bot, [parts[1]], params);
		}
	}
	if (parts.length === 3) {
		if (req.method !== "POST") {
			return await serveMethodNotAllowed();
		}
		if (parts[0] === "github") {
			return await serveGitHubWebhook(req, bot, [parts[1], parts[2]], params);
		}
	}
	return await serveNotFound();
}

async function main(): Promise<void> {
	const telegramToken = env()["TELEGRAM_TOKEN"];
	const telegramSecret = env()["TELEGRAM_SECRET"] || "insecure";
	const secret = env()["GITHUBBOT_SECRET"];
	const baseURL = env()["GITHUBBOT_BASE_URL"];
	const listen = env()["LISTEN"] || "127.0.0.1:8080";

	const bot = new GitHubBot({
		telegramToken,
		telegramSecret,
		secret,
		baseURL,
		listen,
	});

	listenAndServe(listen, async (req): Promise<void> => {
		let response: Response;

		try {
			response = await route(req, bot);
		} catch (e) {
			if (e.message.startsWith('invalid')) {
				response = await serveBadRequest();
			} else {
				response = await serveInternalServerError();
				console.error(e);
			}
		}
		req.respond(response);
	});

	await bot.setup();
}

main();
