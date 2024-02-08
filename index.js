const fs = require('fs');
const millify = require('millify').default;
const stringify = require('json-stringify-pretty-compact');

const lastMonthDownloads = [];
const totalDownloads = [];
const lastMonthPopular = {};
const totalPopular = {};

const jsDelivrLastMonthDownloads = [];
const jsDelivrTotalDownloads = [];
const jsDelivrLastMonthPopular = {};
const jsDelivrTotalPopular = {};

/**
 * Represents the structure of the NPM download registry response.
 *
 * @typedef {Object} NPMDownloadRegistry
 * @property {number} downloads - The total number of downloads.
 * @property {string} start - The start date of the download period.
 * @property {string} end - The end date of the download period.
 * @property {string} package - The name of the package.
 */

/**
 * Represents the structure of the NPM download registry response with a range of downloads.
 *
 * @typedef {Object} NPMDownloadRegistryRange
 * @property {Array<{ downloads: number; day: string }>} downloads - Array of download objects with downloads and day properties.
 * @property {string} start - The start date of the download period.
 * @property {string} end - The end date of the download period.
 * @property {string} package - The name of the package.
 */

/**
 * Represents the structure of a single item in the jsDelivr statistics response.
 *
 * @typedef {Object} JSDelivrStatItem
 * @property {number} rank - The rank of the item.
 * @property {number} typeRank - The type rank of the item.
 * @property {number} total - The total count for the item.
 * @property {Record<string, number>} dates - Record of dates and corresponding numbers.
 */

/**
 * Represents the overall structure of the jsDelivr statistics response.
 *
 * @typedef {Object} JSDelivrStat
 * @property {JSDelivrStatItem} hits - Information about hits.
 * @property {JSDelivrStatItem} bandwidth - Information about bandwidth.
 */

/**
 * Type representing the periods for statistics.
 * @typedef {'month' | 'year' | 's-year'} Period
 */

/**
 * Generates the NPM download count URL for the last month.
 *
 * @param {string} package
 * @returns {string}
 */
const npmMonth = (package) =>
	`https://api.npmjs.org/downloads/point/last-month/${package}`;

/**
 * Generates the NPM download count URL for the total downloads (NPM only stores past 18 months).
 *
 * @param {string} package
 * @returns {string}
 */
const npmTotal = (package) =>
	`https://api.npmjs.org/downloads/range/2020-01-01:3000-01-01/${package}`;

/**
 * Generates the jsDelivr download count URL for the last month.
 *
 * @param {string} package
 * @returns {string}
 */
const jsDelivrMonth = (package) =>
	`https://data.jsdelivr.com/v1/stats/packages/npm/${package}?period=month`;

/**
 * Generates the jsDelivr download URL for a specific period (year).
 *
 * @param {string} package
 * @param {Period} period
 * @returns {string}
 */
const jsDelivrYear = (package, period) =>
	`https://data.jsdelivr.com/v1/stats/packages/npm/${package}?period=${period}`;

/**
 * Get the download statistics for a specific package.
 *
 * @param {string} package - id of the package.
 * @returns {Promise<void>}
 */
const statsGet = async (package) => {
	try {
		const [
			npmMonthResp,
			npmTotalResp,
			jsDelivrMonthResp,
			jsDelivrYearResp,
			jsDelivrLastYearResp,
		] = await Promise.all([
			fetch(npmMonth(package)),
			fetch(npmTotal(package)),
			fetch(jsDelivrMonth(package)),
			fetch(jsDelivrYear(package, 'year')),
			fetch(jsDelivrYear(package, 's-year')),
		]);

		for (const response of [
			npmMonthResp,
			npmTotalResp,
			jsDelivrMonthResp,
			jsDelivrYearResp,
			jsDelivrLastYearResp,
		]) {
			if (!response.ok) {
				console.error(`Failed to fetch ${package} from ${response.url}`);
				if (response.status === 429) {
					console.error('Rate limited. Retrying in 5 seconds.');
					await new Promise((resolve) => setTimeout(resolve, 5000));
					return statsGet(package, type);
				}
			}
		}

		/** @type {[NPMDownloadRegistry, NPMDownloadRegistryRange, JSDelivrStat, JSDelivrStat, JSDelivrStat]} */
		const [
			npmMonthData,
			npmTotalData,
			jsDelivrMonthData,
			jsDelivrYearData,
			jsDelivrLastYearData,
		] = await Promise.all([
			npmMonthResp.json(),
			npmTotalResp.json(),
			jsDelivrMonthResp.json(),
			jsDelivrYearResp.json(),
			jsDelivrLastYearResp.json(),
		]);

		// NPM
		lastMonthDownloads.push(npmMonthData.downloads);
		lastMonthPopular[package] = npmMonthData.downloads;

		const downloadArray = npmTotalData.downloads.map((item) => item.downloads);
		const downloads = downloadArray.reduce((a, b) => a + b, 0); // Sum of all downloads
		totalDownloads.push(downloads);
		totalPopular[package] = downloads;

		// jsDelivr
		jsDelivrLastMonthPopular[package] = jsDelivrMonthData.hits.total;
		jsDelivrTotalPopular[package] =
			jsDelivrYearData.hits.total + jsDelivrLastYearData.hits.total;
		jsDelivrLastMonthDownloads.push(jsDelivrMonthData.hits.total);
		jsDelivrTotalDownloads.push(
			jsDelivrYearData.hits.total + jsDelivrLastYearData.hits.total
		);

		console.log(`Fetched ${package}`);
	} catch (error) {
		console.error(`Failed to fetch ${package}`);
		console.error(error);
		console.error('Continuing in 5 seconds.');
		await new Promise((resolve) => setTimeout(resolve, 5000));
	}
};

// Get fontlist
const legacyFontlist = JSON.parse(
	fs.readFileSync('./data/legacy-fontlist.json', 'utf8')
);

const production = async () => {
	const fontlistResp = await fetch(
		'https://api.fontsource.org/fontlist?variable'
	);
	/** @type {Record<string, boolean>} */
	const fontlist = await fontlistResp.json();

	for (const [key, isVariable] of Object.entries(fontlist)) {
		await statsGet(`@fontsource/${key}`);
		if (isVariable) {
			await statsGet(`@fontsource-variable/${key}`);
		}
	}

	for (const id of Object.keys(legacyFontlist)) {
		await statsGet(`fontsource-${id}`);
	}
};

production().then(() => {
	// Sum up downloads
	const downloadsMonth = lastMonthDownloads.reduce((a, b) => a + b, 0);
	const downloadsTotal = totalDownloads.reduce((a, b) => a + b, 0);
	const downloadsJsDelivrMonth = jsDelivrLastMonthDownloads.reduce(
		(a, b) => a + b,
		0
	);
	const downloadsJsDelivrTotal = jsDelivrTotalDownloads.reduce(
		(a, b) => a + b,
		0
	);

	const existingDownloadsTotal = Object.values(
		JSON.parse(fs.readFileSync('./data/totalPopular.json', 'utf8'))
	).reduce((a, b) => a + b, 0);

	if (downloadsTotal > existingDownloadsTotal) {
		const downloadsMonthBadge = millify(downloadsMonth, {
			precision: 2,
		});
		const downloadsTotalBadge = millify(downloadsTotal, {
			precision: 2,
		});
		const downloadsJsDelivrMonthBadge = millify(downloadsJsDelivrMonth, {
			precision: 2,
		});
		const downloadsJsDelivrTotalBadge = millify(downloadsJsDelivrTotal, {
			precision: 2,
		});

		console.log(`npm Month: ${downloadsMonthBadge}`);
		console.log(`npm Year: ${downloadsTotalBadge}`);
		console.log(`jsDelivr Month: ${downloadsJsDelivrMonthBadge}`);
		console.log(`jsDelivr Year: ${downloadsJsDelivrTotalBadge}`);

		const badgeMonth = {
			schemaVersion: 1,
			label: 'downloads',
			message: `${downloadsMonthBadge}/month`,
			color: 'brightgreen',
		};
		fs.writeFileSync('./data/badgeMonth.json', stringify(badgeMonth));

		const badgeTotal = {
			schemaVersion: 1,
			label: 'downloads',
			message: downloadsTotalBadge,
			color: 'brightgreen',
		};
		fs.writeFileSync('./data/badgeTotal.json', stringify(badgeTotal));

		const badgeJsDelivrMonth = {
			schemaVersion: 1,
			label: 'jsDelivr',
			message: `${downloadsJsDelivrMonthBadge}/month`,
			color: 'ff5627',
		};
		fs.writeFileSync(
			'./data/badgejsDelivrMonth.json',
			stringify(badgeJsDelivrMonth)
		);

		const badgeJsDelivrTotal = {
			schemaVersion: 1,
			label: 'jsDelivr',
			message: downloadsJsDelivrTotalBadge,
			color: 'ff5627',
		};
		fs.writeFileSync(
			'./data/badgejsDelivrTotal.json',
			stringify(badgeJsDelivrTotal)
		);

		// Sort in descending order of values
		const sortedLastMonthPopular = Object.fromEntries(
			Object.entries(lastMonthPopular).sort((a, b) => b[1] - a[1])
		);
		const sortedTotalPopular = Object.fromEntries(
			Object.entries(totalPopular).sort((a, b) => b[1] - a[1])
		);
		const sortedJsDelivrLastMonthPopular = Object.fromEntries(
			Object.entries(jsDelivrLastMonthPopular).sort((a, b) => b[1] - a[1])
		);
		const sortedJsDelivrTotalPopular = Object.fromEntries(
			Object.entries(jsDelivrTotalPopular).sort((a, b) => b[1] - a[1])
		);

		fs.writeFileSync(
			'./data/lastMonthPopular.json',
			stringify(sortedLastMonthPopular)
		);
		fs.writeFileSync('./data/totalPopular.json', stringify(sortedTotalPopular));
		fs.writeFileSync(
			'./data/jsDelivrMonthPopular.json',
			stringify(sortedJsDelivrLastMonthPopular)
		);
		fs.writeFileSync(
			'./data/jsDelivrTotalPopular.json',
			stringify(sortedJsDelivrTotalPopular)
		);
	}
});
