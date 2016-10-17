'use strict';

const https = require('https');
const fs = require('fs');
const _ = require('lodash');

const SVGO = require('svgo');
const svgo = new SVGO();

const isSvgExstension = require('is-svg-exstension');
const isSvg = require('is-svg');

const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const token = process.env.TOKEN || config.token;
const svgo_bot = new TelegramBot(token, { polling: true });

console.log('Svgo_bot starts...');

svgo_bot.on('message', msg => {
	const chatId = msg.chat.id;
	const fileId = _.get(msg, 'document.file_id');
	const fileName = _.get(msg, 'document.file_name');

	// send welcome message on svgo_bot init
	if (msg.text === '/start') {
		sendMessage(chatId, config.welcomeMessage);
		return;
	}

	// handle svg in markup
	msg.text && minifyMarkupSvg({chatId: chatId}, msg.text);

	// handle on file event (svg in file)
	fileId && getFile({chatId: chatId, fileId: fileId, fileName: fileName});
});

/**
 * Minify svg from markup and send it to user
 *
 * @param {Object} params Params
 * @param {Number} params.chatId Chat Id
 * @param {String} svg Svg
 */
const minifyMarkupSvg = (params, svg) => {
	const chatId = params.chatId;

	if (!isSvg(svg)) {
		sendMessage(chatId, `This is not the svg. Please, send svg.`);
		return;
	}

	svgo.optimize(svg, result => {
		if (result.error) {
			sendMessage(chatId, `Error: \`${result.error}\``);
			return;
		}

		svgo_bot.sendMessage(chatId, `\`${result.data}\``, {parse_mode: 'Markdown'});
		console.log(`Minifined svg markup sended: ${chatId}`);
	});
};

/**
 * On file handler
 *
 * @param {Object} params Params
 * @param {Number} params.chatId Chat Id
 * @param {Number} params.fileId File Id
 * @param {String} params.fileName File name
 */
const getFile = params => {
	const chatId = params.chatId;
	const fileId = params.fileId;
	const fileName = params.fileName;

	if (!isSvgExstension(fileName)) {
		sendMessage(chatId, `File \`${fileName}\` isn't svg`);
		return;
	}

	svgo_bot.getFile(fileId)
		.then(usersFile => {
			const chatsDir = `svgs/${chatId}`;
			const usersFilePath = `https://api.telegram.org/file/bot${token}/${usersFile.file_path}`;
			const fileOriginalPath = `${chatsDir}/${fileName}`;
			const fileOriginalWithoutSvg = _.trimEnd(fileOriginalPath, '.svg');
			const fileMinifinedPath = `${fileOriginalWithoutSvg}-minifined.svg`;

			const fullParams = _.assign({}, params, {
				chatsDir: chatsDir,
				usersFilePath: usersFilePath,
				fileOriginalPath: fileOriginalPath,
				fileOriginalWithoutSvg: fileOriginalWithoutSvg,
				fileMinifinedPath: fileMinifinedPath
			});

			createFileOriginal(fullParams, () => createFileMinifined(fullParams, () => sendMinifinedSvg(fullParams)));
		})
		.catch(error => {
			sendMessage(chatId, `Error: \`${error}\``);
		});
};

/**
 * Create direction if it doesn't exist
 *
 * @param {String} dir Direction
 */
const createDir = dir => {
	if (!fs.existsSync(dir)){
		fs.mkdirSync(dir);
	}
};

/**
 * Create original file on server
 *
 * @param {Object} params Params
 * @param {String} params.chatsDir Chats direction
 * @param {String} params.usersFilePath Users file path
 * @param {String} params.fileOriginPath File origin path
 * @param {Function} callback CallBack
 */
const createFileOriginal = (params, callback) => {
	const chatsDir = params.chatsDir;
	const usersFilePath = params.usersFilePath;
	const fileOriginalPath = params.fileOriginalPath;

	createDir('svgs');
	createDir(chatsDir);

	const fileOriginal = fs.createWriteStream(fileOriginalPath);
	const request = https.get(usersFilePath, response => {
		response.pipe(fileOriginal);
		response.on('end', () => {
			callback && callback();
		});
	});
};

/**
 * Create minifined file on server
 *
 * @param {Object} params Params
 * @param {Number} params.chatId Chat Id
 * @param {String} params.fileOriginalPath File's original path
 * @param {String} params.fileOriginalWithoutSvg File's original path without svg
 * @param {String} params.fileMinifinedPath File's minifined path
 * @param {Function} callback CallBack
 */
const createFileMinifined = (params, callback) => {
	const chatId = params.chatId;
	const fileOriginalPath = params.fileOriginalPath;
	const fileOriginalWithoutSvg = params.fileOriginalWithoutSvg;
	const fileMinifinedPath = params.fileMinifinedPath;

	fs.readFile(fileOriginalPath, 'utf-8', (error, data) => {
		if (error) {
			sendMessage(chatId, `Error: \`${error}\``);
			return;
		}

		svgo.optimize(data, result => {
			if (result.error) {
				svgo_bot.sendMessage(chatId, `Error: \`${result.error}\``);
				return;
			}

			fs.writeFile(fileMinifinedPath, result.data, (error, data) => {
				if (error) {
					sendMessage(chatId, `Error: \`${error}\``);
					return;
				}

				callback && callback();
			});
		});
	});
};

/**
 * Send minifined file to user
 *
 * @param {Object} params Params
 * @param {Number} params.chatId Chat Id
 * @param {String} params.fileMinifinedPath File's minifined path
 */
const sendMinifinedSvg = params => {
	const chatId = params.chatId;
	const fileOriginalPath = params.fileOriginalPath;
	const fileMinifinedPath = params.fileMinifinedPath;

	const fileMinifined = fs.createReadStream(fileMinifinedPath);
	svgo_bot.sendDocument(chatId, fileMinifined)
		.then(() => {
			const filesForRemove = [fileOriginalPath, fileMinifinedPath];
			removeFiles(filesForRemove);
			console.log(`Minifined svg file sended: ${chatId}, ${fileMinifinedPath}`);
		})
		.catch(error => {
			sendMessage(chatId, `Error: \`${error}\``);
		});
};

/**
 * Remove files after 1 hour
 *
 * @param {String[]} files Files that will be removed
 */
const removeFiles = files => {
	const TIMEOUT = 3600000;

	_.forEach(files, file => {
		setTimeout(() => {
			fs.unlink(file, error => {
				if (error) {
					console.log(`Remove file ${file} error: ${error}`);
				}

				console.log(`Successful remove file ${file}`);
			});
		}, TIMEOUT);
	});
}

/**
 * Wraper under bot sendMessage
 *
 * @param {Number} chatId Chat Id
 * @param {String} text Message text
 */
const sendMessage = (chatId, text) => {
	svgo_bot.sendMessage(chatId, text, {parse_mode: 'Markdown'})
		.then(() => {
			console.log(`Message sended: ${text}`);
		})
		.catch(error => {
			console.log(`Text sending error: ${error}`);
		});
};

