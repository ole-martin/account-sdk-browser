/* Copyright 2018 Schibsted Products & Technology AS. Licensed under the terms of the MIT license.
 * See LICENSE.md in the project root.
 */

'use strict';

import { assert, isStr, isNonEmptyString, isUrl } from './validate';
import { urlMapper } from './url';
import { ENDPOINTS, NAMESPACE } from './config';
import EventEmitter from 'tiny-emitter';
import JSONPClient from './JSONPClient';
import RESTClient from './RESTClient';
import Cache from './cache';
import * as spidTalk from './spidTalk';

const DEFAULT_CACHE_EXPIRES_IN = 30;
const globalWindow = () => window;

/**
 * Provides features related to monetization
 */
export class Monetization extends EventEmitter {
    /**
     * @param {object} options
     * @param {string} options.clientId - Mandatory client id
     * @param {string} [options.redirectUri] - Redirect uri
     * @param {string} [options.env=PRE] - Schibsted account environment: `PRE`, `PRO` or `PRO_NO`
     * @param {string} [options.sessionDomain] - Example: "https://id.site.com"
     * @throws {SDKError} - If any of options are invalid
     */
    constructor({ clientId, redirectUri, env = 'PRE', sessionDomain, window = globalWindow() }) {
        super();
        spidTalk.emulate(window);
        // validate options
        assert(isNonEmptyString(clientId), 'clientId parameter is required');

        this.cache = new Cache(window && window.sessionStorage);
        this.clientId = clientId;
        this.env = env;
        this.redirectUri = redirectUri;
        this._setSpidServerUrl(env);

        if (sessionDomain) {
            assert(isUrl(sessionDomain), 'sessionDomain parameter is not a valid URL');
            this._setSessionServiceUrl(sessionDomain);
        }
    }

    /**
     * Set SPiD server URL
     * @private
     * @param {string} url
     * @returns {void}
     */
    _setSpidServerUrl(url) {
        assert(isStr(url), `url parameter is invalid: ${url}`);
        this._spid = new JSONPClient({
            serverUrl: urlMapper(url, ENDPOINTS.SPiD),
            defaultParams: { client_id: this.clientId, redirect_uri: this.redirectUri },
        });
    }

    /**
     * Set session-service domain
     * @private
     * @param {string} domain - real URL — (**not** 'PRE' style env key)
     * @returns {void}
     */
    _setSessionServiceUrl(domain) {
        assert(isStr(domain), `domain parameter is invalid: ${domain}`);
        const client_sdrn = `sdrn:${NAMESPACE[this.env]}:client:${this.clientId}`;
        this._sessionService = new RESTClient({
            serverUrl: domain,
            log: this.log,
            defaultParams: { client_sdrn, redirect_uri: this.redirectUri },
        });
    }

    /**
     * Checks if the user has access to a particular product
     * @param {string} productId
     * @param {string} [spId] - Only required if not using the session-service (i.e. only required
     * if not setting `sessionDomain` in the constructor). The spId that was obtained from
     * {@link Identity#hasSession}
     * @returns {Object|null} The data object returned from Schibsted account (or `null` if the user
     * doesn't have access to the given product)
     */
    async hasProduct(productId, spId) {
        const cacheKey = `prd_${productId}_${spId}`;
        const cachedVal = this.cache.get(cacheKey);
        if (cachedVal) {
            return cachedVal;
        }
        let data = null;
        if (this._sessionService) {
            data = await this._sessionService.get(`/hasProduct/${productId}`);
        }
        if (!data) {
            const params = { product_id: productId }
            if (spId) {
                params.sp_id = spId;
            }
            data = await this._spid.get('ajax/hasproduct.js', params);
        }
        if (!data.result) {
            return null;
        }
        const expiresIn = (data.expiresIn || DEFAULT_CACHE_EXPIRES_IN) * 1000;
        this.cache.set(cacheKey, data, expiresIn);
        this.emit('hasProduct', { productId, data });
        return data;
    }

    /**
     * Checks if the user has access to a particular subscription
     * @param {string} subscriptionId
     * @param {string} [spId] - Only required if not using the session-service (i.e. only required
     * if not setting `sessionDomain` in the constructor). The spId that was obtained from
     * {@link Identity#hasSession}
     * @returns {Object|null} The data object returned from Schibsted account (or `null` if the user
     * doesn't have access to the given subscription)
     */
    async hasSubscription(subscriptionId, spId) {
        const cacheKey = `sub_${subscriptionId}_${spId}`;
        const cachedVal = this.cache.get(cacheKey);
        if (cachedVal) {
            return cachedVal;
        }
        let data = null;
        if (this._sessionService) {
            data = await this._sessionService.get(`/hasSubscription/${subscriptionId}`);
        }
        if (!data) {
            const params = { product_id: subscriptionId }
            if (spId) {
                params.sp_id = spId;
            }
            data = await this._spid.get('ajax/hassubscription.js', params);
        }
        if (!data.result) {
            return null;
        }
        const expiresIn = (data.expiresIn || DEFAULT_CACHE_EXPIRES_IN) * 1000;
        this.cache.set(cacheKey, data, expiresIn);
        this.emit('hasSubscription', { subscriptionId, data });
        return data;
    }

    /**
     * Get the url for the end user to review the subscriptions
     * @param {string} [redirectUri=this.redirectUri]
     * @return {string} - The url to the subscriptions review page
     */
    subscriptionsUrl(redirectUri = this.redirectUri) {
        assert(isUrl(redirectUri), `subscriptionsUrl(): redirectUri is invalid`);
        return this._spid.makeUrl('account/subscriptions', { redirect_uri: redirectUri });
    }

    /**
     * Get the url for the end user to review the products
     * @param {string} [redirectUri=this.redirectUri]
     * @return {string} - The url to the products review page
     */
    productsUrl(redirectUri = this.redirectUri) {
        assert(isUrl(redirectUri), `productsUrl(): redirectUri is invalid`);
        return this._spid.makeUrl('account/products', { redirect_uri: redirectUri });
    }
}

export default Monetization;