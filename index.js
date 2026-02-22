import fs from "node:fs";
import stringify from "json-stringify-pretty-compact";
import millify from "millify";
import pRetry, { AbortError } from "p-retry";

/** @type {number[]} */
const lastMonthDownloads = [];
/** @type {number[]} */
const totalDownloads = [];
/** @type {Record<string, number>} */
const lastMonthPopular = {};
/** @type {Record<string, number>} */
const totalPopular = {};

/** @type {number[]} */
const jsDelivrLastMonthDownloads = [];
/** @type {number[]} */
const jsDelivrTotalDownloads = [];
/** @type {Record<string, number>} */
const jsDelivrLastMonthPopular = {};
/** @type {Record<string, number>} */
const jsDelivrTotalPopular = {};

/** @type {string[]} */
const errors = [];

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
 * @param {string} pkg
 * @returns {string}
 */
const npmMonth = (pkg) =>
	`https://api.npmjs.org/downloads/point/last-month/${pkg}`;

/**
 * Generates the NPM download count URL for the total downloads (NPM only stores past 18 months).
 *
 * @param {string} pkg
 * @returns {string}
 */
const npmTotal = (pkg) =>
	`https://api.npmjs.org/downloads/point/last-year/${pkg}`;

/**
 * Generates the jsDelivr download count URL for the last month.
 *
 * @param {string} pkg
 * @returns {string}
 */
const jsDelivrMonth = (pkg) =>
	`https://data.jsdelivr.com/v1/stats/packages/npm/${pkg}?period=month`;

/**
 * Generates the jsDelivr download URL for a specific period (year).
 *
 * @param {string} pkg
 * @param {Period} period
 * @returns {string}
 */
const jsDelivrYear = (pkg, period) =>
	`https://data.jsdelivr.com/v1/stats/packages/npm/${pkg}?period=${period}`;

/**
 * Helper to fetch with p-retry and exponential backoff.
 *
 * @param {string} url
 * @param {string} pkg
 * @returns {Promise<Response>}
 */
const fetchWithRetry = async (url, pkg) => {
	return await pRetry(
		async () => {
			const response = await fetch(url);
			if (!response.ok) {
				if (response.status === 429) {
					throw new Error(`429 on ${url}`);
				}
				throw new AbortError(`Failed to fetch ${url}: ${response.status}`);
			}
			return response;
		},
		{
			onFailedAttempt: ({ error, attemptNumber }) => {
				if (error.message?.startsWith("429")) {
					console.log(
						`  ${error.message} ${pkg} — backing off ${attemptNumber * 10}s`,
					);
				}
			},
			retries: 5,
			minTimeout: 10000,
		},
	);
};

/**
 * Get the download statistics for a specific package.
 *
 * @param {string} pkg - id of the package.
 * @returns {Promise<void>}
 */
const statsGet = async (pkg) => {
	try {
		// NPM sequential
		const npmMonthResp = await fetchWithRetry(npmMonth(pkg), pkg);
		await new Promise((resolve) => setTimeout(resolve, 100));
		const npmTotalResp = await fetchWithRetry(npmTotal(pkg), pkg);
		await new Promise((resolve) => setTimeout(resolve, 100));

		// jsDelivr parallel
		const [jsDelivrMonthResp, jsDelivrYearResp, jsDelivrLastYearResp] =
			await Promise.all([
				fetchWithRetry(jsDelivrMonth(pkg), pkg),
				fetchWithRetry(jsDelivrYear(pkg, "year"), pkg),
				fetchWithRetry(jsDelivrYear(pkg, "s-year"), pkg),
			]);

		/** @type {NPMDownloadRegistry} */
		const npmMonthData = await npmMonthResp.json();
		/** @type {NPMDownloadRegistry} */
		const npmTotalData = await npmTotalResp.json();
		/** @type {JSDelivrStat} */
		const jsDelivrMonthData = await jsDelivrMonthResp.json();
		/** @type {JSDelivrStat} */
		const jsDelivrYearData = await jsDelivrYearResp.json();
		/** @type {JSDelivrStat} */
		const jsDelivrLastYearData = await jsDelivrLastYearResp.json();

		// NPM
		lastMonthDownloads.push(npmMonthData.downloads);
		lastMonthPopular[pkg] = npmMonthData.downloads;
		totalDownloads.push(npmTotalData.downloads);
		totalPopular[pkg] = npmTotalData.downloads;

		// jsDelivr
		jsDelivrLastMonthPopular[pkg] = jsDelivrMonthData.hits.total;
		jsDelivrTotalPopular[pkg] =
			jsDelivrYearData.hits.total + jsDelivrLastYearData.hits.total;
		jsDelivrLastMonthDownloads.push(jsDelivrMonthData.hits.total);
		jsDelivrTotalDownloads.push(
			jsDelivrYearData.hits.total + jsDelivrLastYearData.hits.total,
		);

		console.log(`Fetched ${pkg}`);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`Failed to fetch ${pkg}: ${errorMessage}`);
		errors.push(`${pkg}: ${errorMessage}`);
	}
};

// Get fontlist
const legacyFontlist = JSON.parse(
	fs.readFileSync("./data/legacy-fontlist.json", "utf8"),
);

const production = async () => {
	const legacyIds = Object.keys(legacyFontlist).map((id) => `fontsource-${id}`);
	console.log(
		`npm: Fetching ${legacyIds.length} legacy packages via bulk API...`,
	);
	const totalBatches = Math.ceil(legacyIds.length / 128);

	for (let i = 0; i < legacyIds.length; i += 128) {
		const batch = legacyIds.slice(i, i + 128);
		const batchStr = batch.join(",");
		const batchNum = i / 128 + 1;

		try {
			console.log(
				`npm bulk last-year batch ${batchNum}/${totalBatches} (${batch.length} packages)`,
			);
			const yearResp = await fetchWithRetry(npmTotal(batchStr), "");
			/** @type {Record<string, NPMDownloadRegistry>} */
			const yearData = await yearResp.json();

			console.log(
				`npm bulk last-month batch ${batchNum}/${totalBatches} (${batch.length} packages)`,
			);
			const monthResp = await fetchWithRetry(npmMonth(batchStr), "");
			/** @type {Record<string, NPMDownloadRegistry>} */
			const monthData = await monthResp.json();

			for (const pkg of batch) {
				if (yearData[pkg]) {
					totalDownloads.push(yearData[pkg].downloads);
					totalPopular[pkg] = yearData[pkg].downloads;
				}
				if (monthData[pkg]) {
					lastMonthDownloads.push(monthData[pkg].downloads);
					lastMonthPopular[pkg] = monthData[pkg].downloads;
				}
			}

			// jsDelivr parallel for batch
			await Promise.all(
				batch.map(async (pkg) => {
					try {
						const [jsMonthResp, jsYearResp, jsLastYearResp] = await Promise.all(
							[
								fetchWithRetry(jsDelivrMonth(pkg), pkg),
								fetchWithRetry(jsDelivrYear(pkg, "year"), pkg),
								fetchWithRetry(jsDelivrYear(pkg, "s-year"), pkg),
							],
						);

						/** @type {JSDelivrStat} */
						const jsMonthData = await jsMonthResp.json();
						/** @type {JSDelivrStat} */
						const jsYearData = await jsYearResp.json();
						/** @type {JSDelivrStat} */
						const jsLastYearData = await jsLastYearResp.json();

						jsDelivrLastMonthPopular[pkg] = jsMonthData.hits.total;
						jsDelivrTotalPopular[pkg] =
							jsYearData.hits.total + jsLastYearData.hits.total;
						jsDelivrLastMonthDownloads.push(jsMonthData.hits.total);
						jsDelivrTotalDownloads.push(
							jsYearData.hits.total + jsLastYearData.hits.total,
						);
					} catch (error) {
						const errorMessage =
							error instanceof Error ? error.message : String(error);
						console.error(
							`Failed to fetch jsDelivr for ${pkg}: ${errorMessage}`,
						);
						errors.push(`${pkg} (jsDelivr): ${errorMessage}`);
					}
				}),
			);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			console.error(
				`Failed to fetch NPM bulk batch ${batchNum}: ${errorMessage}`,
			);
			errors.push(`NPM Bulk Batch ${batchNum}: ${errorMessage}`);
		}
	}
	console.log("Legacy npm done");

	const fontlistResp = await fetch(
		"https://api.fontsource.org/fontlist?variable",
	);
	/** @type {Record<string, boolean>} */
	const fontlist = await fontlistResp.json();

	for (const [key, isVariable] of Object.entries(fontlist)) {
		await statsGet(`@fontsource/${key}`);
		if (isVariable) {
			await statsGet(`@fontsource-variable/${key}`);
		}
	}
};

production().then(() => {
	// Sum up downloads
	const downloadsMonth = lastMonthDownloads.reduce((a, b) => a + b, 0);
	const downloadsTotal = totalDownloads.reduce((a, b) => a + b, 0);
	const downloadsJsDelivrMonth = jsDelivrLastMonthDownloads.reduce(
		(a, b) => a + b,
		0,
	);
	const downloadsJsDelivrTotal = jsDelivrTotalDownloads.reduce(
		(a, b) => a + b,
		0,
	);

	const existingDownloadsTotal = Object.values(
		/** @type {Record<string, number>} */
		(JSON.parse(fs.readFileSync("./data/totalPopular.json", "utf8"))),
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
			label: "downloads",
			message: `${downloadsMonthBadge}/month`,
			color: "brightgreen",
		};
		fs.writeFileSync("./data/badgeMonth.json", stringify(badgeMonth));

		const badgeTotal = {
			schemaVersion: 1,
			label: "downloads",
			message: downloadsTotalBadge,
			color: "brightgreen",
		};
		fs.writeFileSync("./data/badgeTotal.json", stringify(badgeTotal));

		const badgeJsDelivrMonth = {
			schemaVersion: 1,
			label: "jsDelivr",
			message: `${downloadsJsDelivrMonthBadge}/month`,
			color: "ff5627",
		};
		fs.writeFileSync(
			"./data/badgejsDelivrMonth.json",
			stringify(badgeJsDelivrMonth),
		);

		const badgeJsDelivrTotal = {
			schemaVersion: 1,
			label: "jsDelivr",
			message: downloadsJsDelivrTotalBadge,
			color: "ff5627",
		};
		fs.writeFileSync(
			"./data/badgejsDelivrTotal.json",
			stringify(badgeJsDelivrTotal),
		);

		// Sort in descending order of values
		const sortedLastMonthPopular = Object.fromEntries(
			Object.entries(lastMonthPopular).sort((a, b) => b[1] - a[1]),
		);
		const sortedTotalPopular = Object.fromEntries(
			Object.entries(totalPopular).sort((a, b) => b[1] - a[1]),
		);
		const sortedJsDelivrLastMonthPopular = Object.fromEntries(
			Object.entries(jsDelivrLastMonthPopular).sort((a, b) => b[1] - a[1]),
		);
		const sortedJsDelivrTotalPopular = Object.fromEntries(
			Object.entries(jsDelivrTotalPopular).sort((a, b) => b[1] - a[1]),
		);

		fs.writeFileSync(
			"./data/lastMonthPopular.json",
			stringify(sortedLastMonthPopular),
		);
		fs.writeFileSync("./data/totalPopular.json", stringify(sortedTotalPopular));
		fs.writeFileSync(
			"./data/jsDelivrMonthPopular.json",
			stringify(sortedJsDelivrLastMonthPopular),
		);
		fs.writeFileSync(
			"./data/jsDelivrTotalPopular.json",
			stringify(sortedJsDelivrTotalPopular),
		);
	}

	if (errors.length > 0) {
		console.error(`\nCompleted with ${errors.length} errors:`);
		for (const error of errors) {
			console.error(`- ${error}`);
		}
		process.exit(1);
	}
});
