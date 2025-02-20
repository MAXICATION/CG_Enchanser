// ==UserScript==
// @name         👾CG_Enchancer
// @namespace    http://tampermonkey.net/
// @description  enchance CG
// @version      1.2
// @author       @maxication
// @namespace    https://github.com/maxication
// @grant        none
// @match        https://www.coinglass.com
// ==/UserScript==
/*
MIT License

Copyright (c) 2024 (https://github.com/MAXICATION)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

class IframeManager {
    #isContainerVisible = false;
    #container = null;
    #iframe = null;
    #overlayIframes = {};
    #activeOverlayKey = null;
    #containerWidth = localStorage.getItem("containerWidth") || "600px";

    // ***** Новый функционал для ЛЕВОГО контейнера *****
    #leftContainer = null;
    #leftIframe = null;
    #leftContainerVisible = false;
    #leftContainerWidth = localStorage.getItem("leftContainerWidth") || "300px";
    #isLeftResizing = false;
    #leftResizeHandle = null;
    #leftResizeOverlay = null;
    // ***************************************************

    #lastClickedCoin = "";
    #isResizing = false;
    #resizeHandle = null;
    #resizeOverlay = null;

    // Основные структуры данных
    #watchlists = JSON.parse(localStorage.getItem("watchlists")) || {};
    #notes = JSON.parse(localStorage.getItem("notes")) || {};
    #history = JSON.parse(localStorage.getItem("history")) || [];

    // Новый объект для хранения времени добавления монеты
    #watchlistTimestamps = JSON.parse(localStorage.getItem("watchlistTimestamps")) || {};

    // Состояние, свернут или развернут вотчлист (не сохраняем в localStorage, только для текущей сессии)
    #watchlistCollapseState = {};

    /**
     * Кнопки, которые отображают соответствующую страницу во *встроенном* iframe (справа)
     */
    #buttonsDataMain = {
        VS: {
            url: "https://www.coinglass.com/pro/i/VisualScreener",
            textColor: "#d40078",
        },
        LQ_HM: {
            url: "https://www.coinglass.com/pro/futures/LiquidationHeatMap",
            textColor: "#ff4500",
        },
        RSI_HM: {
            url: "https://www.coinglass.com/pro/i/RsiHeatMap",
            textColor: "#0074cc",
        },
        OB_HM: {
            url: "https://www.coinglass.com/LiquidityHeatmap",
            textColor: "#008f11",
        },
        ON_CHAIN: {
            url: "https://www.coinglass.com/InflowAndOutflow",
            textColor: "#a0a0a0",
        },
        FUND: {
            url: "https://www.coinglass.com/FundingRate",
            textColor: "#00ced1",
        },
        WHALE: {
            url: "https://www.coinglass.com/large-orderbook-statistics",
            textColor: "#1E90FF",
        },
        MULTI: {
            url: "https://stakan.io/dashboard",
            textColor: "#3E00FF",
        },
        "G/L": {
            url: "https://www.coinglass.com/gainers-losers",
            textColor: "#ffae00",
        },
        ALERTS: {
            url: "https://www.coinglass.com/alert",
            textColor: "#009688",
        },
    };

    /**
     * Кнопки, которые открываются во *внешней вкладке* (подстановка {coin} в ссылку)
     */
    #buttonsDataExternal = {
        TW: {
            url: "https://www.tradingview.com/chart/Kb1uNw2E/?symbol=BYBIT:{coin}USDT.P",
            textColor: "#3399ff",
            openInNewTab: true,
        },
        BB: {
            url: "https://www.bybit.com/trade/usdt/{coin}USDT",
            textColor: "#ff33ff",
            openInNewTab: true,
        },
    };

    constructor() {
        // Защита от повторного запуска
        if (window.hasRun) return;
        window.hasRun = true;

        this.#init();
    }

    #init = () => {
        const initialize = () => {
            // Создаем правый контейнер (основной) и сразу показываем
            this.#createContainer();
            this.#showContainer();

            // Создаём левый контейнер (Orion) - по умолчанию скрыт
            this.#createLeftContainer();
            // Если хотим, чтобы левый контейнер сразу был виден:
            // this.#showLeftContainer();

            // ГЛОБАЛЬНЫЙ слушатель кликов по всему документу
            this.#addGlobalClickListener();

            // Слушатель контекстного меню
            this.#addContextMenuListener();
        };
        document.addEventListener("click", (event) => {
            const link = event.target.closest("a");

            if (link && link.querySelector(".symbol-and-logo")) {
                event.preventDefault(); // Блокируем переход по ссылке
                this.handleCoinClicks(event); // Запускаем твою функцию поиска
            }
        }, true);


        // Инициализация при загрузке страницы
        window.addEventListener("load", initialize);

        // Инициализация при возврате на страницу через кнопку "Назад"
        window.addEventListener("pageshow", (event) => {
            if (event.persisted) {
                console.log("Page restored from cache, reinitializing...");
                initialize();
            }
        });

        // Закрываем кастомное контекстное меню при клике вне его
        document.addEventListener("click", () => {
            const existingMenu = document.querySelector("#customContextMenu");
            if (existingMenu) {
                existingMenu.remove();
            }
        });
    };

    /**
     * ==========================
     *         ЛЕВЫЙ КОНТЕЙНЕР
     * ==========================
     */

    #createLeftContainer = () => {
        if (document.querySelector("#leftContainer")) return;

        this.#leftContainer = document.createElement("div");
        this.#leftContainer.id = "leftContainer";

        Object.assign(this.#leftContainer.style, {
            position: "fixed",
            left: "0",
            top: "0",
            width: this.#leftContainerWidth,
            height: "100%",
            backgroundColor: "#333",
            zIndex: "1000",
            display: "none",          // изначально скрыт
            boxSizing: "border-box",
            overflowY: "hidden",
            padding: "0px",
        });

        // Встраиваемый iframe: Orion Alerts
        this.#leftIframe = document.createElement("iframe");
        this.#leftIframe.src = "https://orionterminal.com/alerts";
        Object.assign(this.#leftIframe.style, {
            width: "100%",
            height: "100%",
            border: "none",
        });

        // Добавляем в DOM
        this.#leftContainer.appendChild(this.#leftIframe);

        // Создаём ползунок для изменения размера слева
        this.#createLeftResizeHandle();

        document.body.appendChild(this.#leftContainer);
    };

    #showLeftContainer = () => {
        if (!this.#leftContainer) {
            this.#createLeftContainer();
        }
        this.#toggleLeftContainerVisibility(true);
    };

    #hideLeftContainer = () => {
        if (this.#leftContainer) {
            this.#toggleLeftContainerVisibility(false);
        }
    };

    #toggleLeftContainerVisibility = (isVisible) => {
        this.#leftContainer.style.display = isVisible ? "block" : "none";
        this.#leftContainerVisible = isVisible;

        const mainContent = document.querySelector("#__next");
        if (mainContent) {
            mainContent.style.marginLeft = isVisible ? this.#leftContainerWidth : "0";
            mainContent.style.transition = "margin-left 0.2s ease";
        }

        // Показываем/скрываем ползунок
        if (this.#leftResizeHandle) {
            this.#leftResizeHandle.style.display = isVisible ? "block" : "none";
        }
    };

    #createLeftResizeHandle = () => {
        this.#leftResizeHandle = document.createElement("div");
        this.#leftResizeHandle.id = "leftResizeHandle";

        Object.assign(this.#leftResizeHandle.style, {
            position: "absolute",
            top: "0",
            right: "0", // ручка будет справа, т.к. контейнер слева
            width: "4px",
            height: "100%",
            cursor: "ew-resize",
            zIndex: "1002",
            backgroundColor: "#888",
            opacity: "0.5",
            display: "none",
        });

        const handle = document.createElement("div");
        handle.id = "leftResizeHandleHandle";
        Object.assign(handle.style, {
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "10px",
            height: "20px",
            backgroundColor: "#ccc",
            borderRadius: "5px",
            cursor: "ew-resize",
        });

        handle.addEventListener("mousedown", (e) => {
            this.#isLeftResizing = true;
            this.#showLeftResizeOverlay();
            document.addEventListener("mousemove", this.#resizeLeftContainer);
            document.addEventListener("mouseup", this.#stopLeftResizing);
            e.preventDefault();
        });

        this.#leftResizeHandle.appendChild(handle);
        this.#leftContainer.appendChild(this.#leftResizeHandle);
    };

    #showLeftResizeOverlay = () => {
        if (!this.#leftResizeOverlay) {
            this.#leftResizeOverlay = document.createElement("div");
            Object.assign(this.#leftResizeOverlay.style, {
                position: "fixed",
                top: "0",
                left: "0",
                width: "100%",
                height: "100%",
                cursor: "ew-resize",
                zIndex: "9999",
                backgroundColor: "transparent",
            });

            this.#leftResizeOverlay.addEventListener("mousemove", this.#resizeLeftContainer);
            this.#leftResizeOverlay.addEventListener("mouseup", this.#stopLeftResizing);

            document.body.appendChild(this.#leftResizeOverlay);
        }
        this.#leftResizeOverlay.style.display = "block";
    };

    #hideLeftResizeOverlay = () => {
        if (this.#leftResizeOverlay) {
            this.#leftResizeOverlay.style.display = "none";
        }
    };

    #resizeLeftContainer = (event) => {
        if (!this.#isLeftResizing) return;
        // Позиция курсора — это новое значение ширины
        const newWidth = event.clientX; // расстояние от левого края окна

        // Вводим ограничения
        if (newWidth >= 200 && newWidth <= window.innerWidth * 0.9) {
            this.#leftContainerWidth = `${newWidth}px`;
            this.#leftContainer.style.width = this.#leftContainerWidth;

            // Сохраняем новое значение в localStorage
            localStorage.setItem("leftContainerWidth", this.#leftContainerWidth);

            // Сдвигаем основной контент
            const mainContent = document.querySelector("#__next");
            if (mainContent && this.#leftContainerVisible) {
                mainContent.style.marginLeft = this.#leftContainerWidth;
            }
        }
    };

    #stopLeftResizing = () => {
        this.#isLeftResizing = false;
        document.removeEventListener("mousemove", this.#resizeLeftContainer);
        document.removeEventListener("mouseup", this.#stopLeftResizing);
        this.#hideLeftResizeOverlay();
    };

    /**
     * ===========================
     *        ПРАВЫЙ КОНТЕЙНЕР
     * ===========================
     */
    #createContainer = () => {
        if (document.querySelector("#customContainer")) return;

        this.#container = document.createElement("div");
        this.#container.id = "customContainer";

        const containerStyles = {
            position: "fixed",
            right: "0",
            top: "0",
            width: this.#containerWidth,
            height: "100%",
            backgroundColor: "#333",
            zIndex: "1000",
            display: "none",
            boxSizing: "border-box",
            overflowY: "hidden",
            padding: "0px",
        };

        Object.assign(this.#container.style, containerStyles);

        this.#iframe = document.createElement("iframe");
        this.#iframe.src = "/tv/Bybit_BTCUSDT"; // ваш трейдингвью (по умолчанию)
        Object.assign(this.#iframe.style, {
            width: "100%",
            height: "calc(100% - 40px)",
            border: "none",
        });

        const controlPanel = this.#createControlPanel();

        this.#container.appendChild(controlPanel);
        this.#container.appendChild(this.#iframe);

        // Ползунок для изменения размера (справа)
        this.#createResizeHandle();

        document.body.appendChild(this.#container);
    };

    #showContainer = () => {
        if (!this.#container) {
            this.#createContainer();
        }
        this.#toggleContainerVisibility(true);
    };

    #hideContainer = () => {
        if (this.#container) {
            this.#toggleContainerVisibility(false);
        }
    };

    #toggleContainerVisibility = (isVisible) => {
        this.#container.style.display = isVisible ? "block" : "none";
        this.#isContainerVisible = isVisible;

        const mainContent = document.querySelector("#__next");
        if (mainContent) {
            mainContent.style.marginRight = isVisible ? this.#containerWidth : "0";
            mainContent.style.transition = "margin-right 0.2s ease";
        }

        // Показываем/скрываем ползунок
        if (this.#resizeHandle) {
            this.#resizeHandle.style.display = isVisible ? "block" : "none";
        }
    };

    #createResizeHandle = () => {
        this.#resizeHandle = document.createElement("div");
        this.#resizeHandle.id = "resizeHandle";
        Object.assign(this.#resizeHandle.style, {
            position: "absolute",
            top: "0",
            left: "0",
            width: "4px",
            height: "100%",
            cursor: "ew-resize",
            zIndex: "1002",
            backgroundColor: "#888",
            opacity: "0.5",
            display: "none",
        });

        const handle = document.createElement("div");
        handle.id = "resizeHandleHandle";
        Object.assign(handle.style, {
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "10px",
            height: "20px",
            backgroundColor: "#ccc",
            borderRadius: "5px",
            cursor: "ew-resize",
        });

        handle.addEventListener("mousedown", (e) => {
            this.#isResizing = true;
            this.#showResizeOverlay();
            document.addEventListener("mousemove", this.#resizeContainer);
            document.addEventListener("mouseup", this.#stopResizing);
            e.preventDefault();
        });

        this.#resizeHandle.appendChild(handle);
        this.#container.appendChild(this.#resizeHandle);
    };

    #showResizeOverlay = () => {
        if (!this.#resizeOverlay) {
            this.#resizeOverlay = document.createElement("div");
            Object.assign(this.#resizeOverlay.style, {
                position: "fixed",
                top: "0",
                left: "0",
                width: "100%",
                height: "100%",
                cursor: "ew-resize",
                zIndex: "9999",
                backgroundColor: "transparent",
            });

            this.#resizeOverlay.addEventListener("mousemove", this.#resizeContainer);
            this.#resizeOverlay.addEventListener("mouseup", this.#stopResizing);

            document.body.appendChild(this.#resizeOverlay);
        }
        this.#resizeOverlay.style.display = "block";
    };

    #hideResizeOverlay = () => {
        if (this.#resizeOverlay) {
            this.#resizeOverlay.style.display = "none";
        }
    };

    #resizeContainer = (event) => {
        if (!this.#isResizing) return;
        const newWidth = window.innerWidth - event.clientX;
        if (newWidth >= 200 && newWidth <= window.innerWidth * 0.9) {
            this.#containerWidth = `${newWidth}px`;
            this.#container.style.width = this.#containerWidth;
            this.#saveContainerWidth();

            const mainContent = document.querySelector("#__next");
            if (mainContent && this.#isContainerVisible) {
                mainContent.style.marginRight = this.#containerWidth;
            }
        }
    };

    #stopResizing = () => {
        this.#isResizing = false;
        document.removeEventListener("mousemove", this.#resizeContainer);
        document.removeEventListener("mouseup", this.#stopResizing);
        this.#hideResizeOverlay();
    };

    #saveContainerWidth = () => {
        localStorage.setItem("containerWidth", this.#containerWidth);
    };

    /**
     * Панель управления (вверху правого контейнера).
     * Добавим сюда кнопку "ORION" для левого контейнера.
     */
    #createControlPanel = () => {
        const controlPanel = document.createElement("div");
        controlPanel.id = "controlPanel";

        const controlPanelStyles = {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "5px",
            backgroundColor: "#222",
            height: "40px",
            boxSizing: "border-box",
            position: "relative",
            zIndex: "1002",
        };

        Object.assign(controlPanel.style, controlPanelStyles);

        // Кнопка закрытия правого контейнера
        const closeButton = this.#createButton({
            id: "closeButton",
            text: "✖",
            onClick: () => this.#hideContainer(),
            styles: {
                cursor: "pointer",
                color: "white",
                background: "#444",
                fontSize: "15px",
                border: "none",
                padding: "5px 10px",
            },
        });

        // Основной блок кнопок (iframe)
        const buttonsContainerMain = document.createElement("div");
        buttonsContainerMain.style.display = "flex";
        buttonsContainerMain.style.gap = "5px";

        for (const [key, data] of Object.entries(this.#buttonsDataMain)) {
            const button = this.#createButton({
                id: `button_${key}`,
                text: key,
                onClick: () => this.#toggleOverlayIframe(key, data.url),
                styles: {
                    cursor: "pointer",
                    color: data.textColor,
                    background: "#444",
                    fontSize: "15px",
                    border: "none",
                    padding: "5px 10px",
                },
            });
            buttonsContainerMain.appendChild(button);
        }

        // Отдельный блок кнопок (внешние ссылки)
        const buttonsContainerExternal = document.createElement("div");
        buttonsContainerExternal.style.display = "flex";
        buttonsContainerExternal.style.gap = "5px";
        buttonsContainerExternal.style.marginLeft = "20px";

        for (const [key, data] of Object.entries(this.#buttonsDataExternal)) {
            const button = this.#createButton({
                id: `button_${key}`,
                text: key,
                onClick: () => this.#toggleOverlayIframe(key, data.url),
                styles: {
                    cursor: "pointer",
                    color: data.textColor,
                    background: "#444",
                    fontSize: "15px",
                    border: "none",
                    padding: "5px 10px",
                },
            });
            buttonsContainerExternal.appendChild(button);
        }

        // Группа кнопок (Watchlist, History, + наша ORION)
        const groupedButtonsContainer = document.createElement("div");
        groupedButtonsContainer.style.display = "flex";
        groupedButtonsContainer.style.gap = "5px";

        // Кнопка для отображения Watchlist
        const viewWatchlistButton = this.#createButton({
            id: "viewWatchlistButton",
            text: "📋",
            onClick: () => this.#createWatchlistPopup(),
            styles: {
                cursor: "pointer",
                color: "white",
                background: "#444",
                fontSize: "15px",
                border: "none",
                padding: "5px 10px",
            },
        });

        // Кнопка для отображения Истории
        const viewHistoryButton = this.#createButton({
            id: "viewHistoryButton",
            text: "🕰️",
            onClick: () => this.#createHistoryPopup(),
            styles: {
                cursor: "pointer",
                color: "white",
                background: "#444",
                fontSize: "15px",
                border: "none",
                padding: "5px 10px",
            },
        });

        // Кнопка для левого контейнера (Orion)
        const orionButton = this.#createButton({
            id: "orionButton",
            text: "ORION",
            onClick: () => {
                if (this.#leftContainerVisible) {
                    this.#hideLeftContainer();
                } else {
                    this.#showLeftContainer();
                }
            },
            styles: {
                cursor: "pointer",
                color: "white",
                background: "#444",
                fontSize: "15px",
                border: "none",
                padding: "5px 10px",
            },
        });

        groupedButtonsContainer.appendChild(viewWatchlistButton);
        groupedButtonsContainer.appendChild(viewHistoryButton);
        groupedButtonsContainer.appendChild(orionButton);

        // Добавляем все элементы в панель управления
        controlPanel.appendChild(closeButton);
        controlPanel.appendChild(buttonsContainerMain);
        controlPanel.appendChild(buttonsContainerExternal);
        controlPanel.appendChild(groupedButtonsContainer);

        return controlPanel;
    };

    #createButton = ({ id, text, onClick, styles }) => {
        const button = document.createElement("button");
        button.id = id;
        button.textContent = text;
        button.addEventListener("click", onClick);

        const defaultStyles = {
            cursor: "pointer",
            color: "white",
            background: "#444",
            fontSize: "15px",
            border: "none",
            padding: "5px 10px",
            borderRadius: "8px",
            transition: "background-color 0.2s ease, transform 0.1s ease",
        };

        Object.assign(button.style, defaultStyles, styles);

        // Hover-эффекты
        button.addEventListener("mouseenter", () => {
            button.style.backgroundColor = "#666";
            button.style.transform = "scale(1.05)";
        });
        button.addEventListener("mouseleave", () => {
            button.style.backgroundColor = styles.background || "#444";
            button.style.transform = "scale(1)";
        });
        // Эффект при нажатии
        button.addEventListener("mousedown", () => {
            button.style.transform = "scale(0.95)";
        });
        button.addEventListener("mouseup", () => {
            button.style.transform = "scale(1.05)";
        });

        return button;
    };

    /**
     * Логика переключения оверлеев (правое iframe) или открытия ссылки
     * во внешней вкладке (если openInNewTab).
     */
    #toggleOverlayIframe = (key, url) => {
        const data = this.#buttonsDataMain[key] || this.#buttonsDataExternal[key];

        // Если кнопка открывает ссылку в новой вкладке
        if (data?.openInNewTab) {
            if (!this.#lastClickedCoin) {
                alert("Сначала кликните по монете в таблице, чтобы подставить её в ссылку.");
                return;
            }
            const finalUrl = data.url.replace("{coin}", this.#lastClickedCoin);
            window.open(finalUrl, "_blank");
            return;
        }

        // Иначе показываем/скрываем оверлей внутри правого контейнера
        if (this.#activeOverlayKey === key) {
            // Если тот же оверлей, прячем его
            if (this.#overlayIframes[key]) {
                this.#overlayIframes[key].style.display = "none";
            }
            this.#activeOverlayKey = null;
        } else {
            // Скрываем предыдущий
            if (this.#activeOverlayKey && this.#overlayIframes[this.#activeOverlayKey]) {
                this.#overlayIframes[this.#activeOverlayKey].style.display = "none";
            }

            // Если ещё не создан iframe
            if (!this.#overlayIframes[key]) {
                const overlayIframe = document.createElement("iframe");
                overlayIframe.src = url;
                Object.assign(overlayIframe.style, {
                    position: "absolute",
                    top: "40px",
                    left: "0",
                    width: "100%",
                    height: "calc(100% - 40px)",
                    border: "none",
                    zIndex: "1001",
                });

                overlayIframe.addEventListener("load", () => {
                    // Автопоиск для LQ_HM / WHALE
                    if (key === "LQ_HM" || key === "WHALE") {
                        overlayIframe.contentWindow.scrollTo(0, 260);
                        setTimeout(() => {
                            this.#injectAutocompleteSearch(overlayIframe, this.#lastClickedCoin);
                        }, 200);
                    }
                });

                this.#container.appendChild(overlayIframe);
                this.#overlayIframes[key] = overlayIframe;
            } else {
                this.#overlayIframes[key].style.display = "block";
                if (key === "LQ_HM" || key === "WHALE") {
                    setTimeout(() => {
                        this.#injectAutocompleteSearch(this.#overlayIframes[key], this.#lastClickedCoin);
                    }, 1000);
                    this.#overlayIframes[key].contentWindow.scrollTo(0, 260);
                }
            }

            this.#activeOverlayKey = key;
        }
    };

    /**
     * Автопоиск внутри LQ_HM / WHALE
     */
    #injectAutocompleteSearch = (iframe, coinName) => {
        if (!coinName) return;

        const searchScript = `(function() {
            'use strict';
            const performSearch = () => {
                try {
                    const targetElement = document.querySelector('div.MuiAutocomplete-root input');
                    if (targetElement) {
                        targetElement.focus();
                        targetElement.value = '';
                        document.execCommand('insertText', false, '${coinName}');
                        targetElement.dispatchEvent(new Event('input', { bubbles: true }));
                        targetElement.dispatchEvent(new Event('change', { bubbles: true }));
                        setTimeout(() => {
                            const dropdownItem = document.querySelector('li.MuiAutocomplete-option');
                            if (dropdownItem) {
                                dropdownItem.click();
                            } else {
                                console.warn('Dropdown item not found');
                            }
                        }, 700);
                    } else {
                        console.warn('Search input not found');
                    }
                } catch (error) {
                    console.error('Error in autocomplete search:', error);
                }
            };
            setTimeout(performSearch, 200);
        })();`;

        if (iframe?.contentWindow && iframe.contentDocument.readyState === "complete") {
            try {
                iframe.contentWindow.eval(searchScript);
            } catch (e) {
                console.error("Failed to inject autocomplete script:", e);
            }
        } else {
            iframe?.addEventListener("load", () => {
                if (iframe?.contentWindow) {
                    try {
                        iframe.contentWindow.eval(searchScript);
                    } catch (e) {
                        console.error("Failed to inject script after load:", e);
                    }
                }
            });
        }
    };

    /**
     * Теперь вешаем глобальный слушатель кликов:
     */
    #addGlobalClickListener = () => {
        document.addEventListener("click", (event) => this.#handleCoinClicks(event));
    };

    #handleCoinClicks = (event) => {
        const containerElement = event.target.closest("div.symbol-and-logo");
        if (!containerElement) return;

        // Предотвращаем переход по ссылке
        event.preventDefault();
        event.stopPropagation();

        // Далее ваша логика...
        const coinNameElement = containerElement.querySelector("div.symbol-name");
        const coinName = coinNameElement ? coinNameElement.textContent.trim() : "";
        if (!coinName) return;

        this.#lastClickedCoin = coinName;
        this.#showContainer();
        this.#startSearch(coinName);
        this.#addToHistory(coinName);

        // Автопоиск для открытых оверлеев LQ_HM, WHALE
        ["LQ_HM", "WHALE"].forEach((key) => {
            const iframe = this.#overlayIframes[key];
            if (iframe && iframe.style.display !== "none") {
                this.#injectAutocompleteSearch(iframe, coinName);
            }
        });
    };


    #addToHistory = (coinName) => {
        const timestamp = new Date().toLocaleString();
        this.#history.unshift({ coin: coinName, time: timestamp });
        if (this.#history.length > 50) {
            this.#history.pop();
        }
        localStorage.setItem("history", JSON.stringify(this.#history));
    };

    #startSearch = (coinName) => {
        const script = `(function() {
            'use strict';

            const openSearch = () => {
                try {
                    const searchButton = document.querySelector('#__next > main > div.baseBg.tv-head > div > button:nth-child(3)');
                    if (searchButton) {
                        searchButton.click();
                        startMutationObserver();
                    } else {
                        console.warn('Search button not found');
                    }
                } catch (error) {
                    console.error('Error in openSearch:', error);
                }
            };

            const insertTextAsTyping = (coinName) => {
                try {
                    const searchInput = document.querySelector('#tv-ss');
                    if (searchInput) {
                        searchInput.value = "";
                        searchInput.focus();
                        document.execCommand('insertText', false, coinName);
                        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                        searchInput.dispatchEvent(new Event('change', { bubbles: true }));
                    } else {
                        console.warn('Search input not found');
                    }
                } catch (error) {
                    console.error('Error in insertTextAsTyping:', error);
                }
            };

            const selectPreferredExchange = () => {
                try {
                    const exchangesToTry = ["Binance", "Bybit"];
                    for (const exchangeName of exchangesToTry) {
                        const rows = document.querySelectorAll('li .MuiButtonBase-root[role="button"]');
                        for (const row of rows) {
                            const exchangeText = row.querySelector('.css-nvudtm');
                            if (exchangeText?.textContent.trim() === exchangeName) {
                                row.click();
                                return true;
                            }
                        }
                    }
                    console.warn('Preferred exchange not found');
                    return false;
                } catch (error) {
                    console.error('Error in selectPreferredExchange:', error);
                    return false;
                }
            };

            const hideModal = () => {
                try {
                    const modal = document.querySelector('body > div.MuiModal-root.css-1sjpovq');
                    if (modal) {
                        modal.style.opacity = '0';
                        modal.style.pointerEvents = 'none';
                        return true;
                    }
                    return false;
                } catch (error) {
                    console.error('Error in hideModal:', error);
                    return false;
                }
            };

            const startMutationObserver = () => {
                try {
                    const observer = new MutationObserver((mutationsList, observer) => {
                        for (const mutation of mutationsList) {
                            if (mutation.type === 'childList' && hideModal()) {
                                observer.disconnect();
                            }
                        }
                    });
                    observer.observe(document.body, { childList: true, subtree: true });
                } catch (error) {
                    console.error('Error in startMutationObserver:', error);
                }
            };

            const searchAndSelectCoin = (coinName) => {
                try {
                    openSearch();
                    setTimeout(() => {
                        insertTextAsTyping(coinName);
                        setTimeout(selectPreferredExchange, 800);
                    }, 200);
                } catch (error) {
                    console.error('Error in searchAndSelectCoin:', error);
                }
            };

            searchAndSelectCoin("${coinName}");
        })();`;

        if (
            this.#iframe?.contentWindow &&
            this.#iframe.contentDocument.readyState === "complete"
        ) {
            try {
                this.#iframe.contentWindow.eval(script);
            } catch (e) {
                console.error("Failed to inject script:", e);
            }
        } else {
            this.#iframe?.addEventListener("load", () => {
                if (this.#iframe?.contentWindow) {
                    try {
                        this.#iframe.contentWindow.eval(script);
                    } catch (e) {
                        console.error("Failed to inject script after load:", e);
                    }
                }
            });
        }
    };

    /**
     * Контекстное меню для управления вотчлистами
     */
    #addContextMenuListener = () => {
        document.addEventListener("contextmenu", (event) => this.#handleContextMenu(event));
    };

    #handleContextMenu = (event) => {
        const containerElement = event.target.closest("div.symbol-and-logo");
        if (containerElement) {
            event.preventDefault();
            const coinNameElement = containerElement.querySelector("div.symbol-name");
            const coinName = coinNameElement ? coinNameElement.textContent.trim() : "";
            if (!coinName) return;
            this.#createContextMenu(event.pageX, event.pageY, coinName);
        }
    };

    #createContextMenu = (x, y, coinName) => {
        const existingMenu = document.querySelector("#customContextMenu");
        if (existingMenu) {
            existingMenu.remove();
        }

        const menu = document.createElement("div");
        menu.id = "customContextMenu";
        Object.assign(menu.style, {
            position: "absolute",
            top: `${y}px`,
            left: `${x}px`,
            backgroundColor: "#444",
            color: "white",
            border: "1px solid #666",
            zIndex: "2000",
            padding: "10px",
            borderRadius: "5px",
            boxShadow: "0 2px 10px rgba(0, 0, 0, 0.5)",
        });

        if (Object.keys(this.#watchlists).length === 0) {
            const noWatchlistsMessage = document.createElement("p");
            noWatchlistsMessage.textContent = "No available watchlists";
            noWatchlistsMessage.style.margin = "0 0 10px 0";
            menu.appendChild(noWatchlistsMessage);
        } else {
            for (const watchlistName in this.#watchlists) {
                const watchlist = this.#watchlists[watchlistName];
                const isCoinInWatchlist = watchlist.includes(coinName);

                const button = this.#createButton({
                    id: `watchlist_${watchlistName}_${coinName}`,
                    text: isCoinInWatchlist
                        ? `Remove from ${watchlistName}`
                        : `Add to ${watchlistName}`,
                    onClick: () => {
                        this.#toggleCoinInWatchlist(watchlistName, coinName);
                        menu.remove();
                    },
                    styles: {
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        marginBottom: "5px",
                        backgroundColor: "#555",
                        color: "white",
                        border: "none",
                        padding: "5px 10px",
                        borderRadius: "3px",
                    },
                });
                menu.appendChild(button);
            }
        }

        // Создать новый вотчлист
        const newWatchlistButton = this.#createButton({
            id: "createNewWatchlist",
            text: "Create new watchlist",
            onClick: () => {
                const watchlistName = prompt("Enter a name for the new watchlist:");
                if (watchlistName) {
                    if (!this.#watchlists[watchlistName]) {
                        this.#watchlists[watchlistName] = [];
                        localStorage.setItem("watchlists", JSON.stringify(this.#watchlists));
                        alert(`Watchlist '${watchlistName}' has been created`);
                    } else {
                        alert(`Watchlist '${watchlistName}' already exists`);
                    }
                }
                menu.remove();
            },
            styles: {
                display: "block",
                width: "100%",
                textAlign: "left",
                marginTop: "10px",
                backgroundColor: "#555",
                color: "white",
                border: "none",
                padding: "5px 10px",
                borderRadius: "3px",
            },
        });
        menu.appendChild(newWatchlistButton);

        document.body.appendChild(menu);
    };

    #toggleCoinInWatchlist = (watchlistName, coinName) => {
        const watchlist = this.#watchlists[watchlistName];
        const index = watchlist.indexOf(coinName);

        if (index !== -1) {
            // Удаляем монету
            watchlist.splice(index, 1);

            // Удаляем время добавления
            if (this.#watchlistTimestamps[watchlistName]?.[coinName]) {
                delete this.#watchlistTimestamps[watchlistName][coinName];
                localStorage.setItem("watchlistTimestamps", JSON.stringify(this.#watchlistTimestamps));
            }

            // Удаляем заметку
            if (this.#notes[watchlistName]?.[coinName]) {
                delete this.#notes[watchlistName][coinName];
                localStorage.setItem("notes", JSON.stringify(this.#notes));
            }
        } else {
            // Добавляем монету
            watchlist.push(coinName);
            // Запоминаем дату/время
            if (!this.#watchlistTimestamps[watchlistName]) {
                this.#watchlistTimestamps[watchlistName] = {};
            }
            this.#watchlistTimestamps[watchlistName][coinName] = new Date().toLocaleString();
            localStorage.setItem("watchlistTimestamps", JSON.stringify(this.#watchlistTimestamps));
        }

        localStorage.setItem("watchlists", JSON.stringify(this.#watchlists));
    };

    /**
     * Окно со списками
     */
    #createWatchlistPopup = () => {
        const existingPopup = document.getElementById("watchlistPopup");
        if (existingPopup) {
            existingPopup.remove();
        }

        const popup = document.createElement("div");
        popup.id = "watchlistPopup";
        Object.assign(popup.style, {
            position: "fixed",
            width: "400px",
            height: "500px",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            backgroundColor: "#222",
            color: "white",
            zIndex: "2000",
            border: "1px solid #666",
            borderRadius: "5px",
            boxShadow: "0 2px 10px rgba(0,0,0,0.5)",
            display: "flex",
            flexDirection: "column",
        });

        // Заголовок
        const header = document.createElement("div");
        Object.assign(header.style, {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px",
            backgroundColor: "#333",
            borderBottom: "1px solid #444",
        });

        const title = document.createElement("h3");
        title.textContent = "Watchlist";
        title.style.margin = "0";

        const closeButton = this.#createButton({
            id: "closeWatchlistPopup",
            text: "✖",
            onClick: () => popup.remove(),
            styles: {
                backgroundColor: "transparent",
                border: "none",
                color: "white",
                fontSize: "20px",
                padding: "0 5px",
            },
        });

        header.appendChild(title);
        header.appendChild(closeButton);

        // Контейнер содержимого
        const content = document.createElement("div");
        Object.assign(content.style, {
            flex: "1",
            overflowY: "auto",
            padding: "10px",
        });

        // Футер
        const footer = document.createElement("div");
        Object.assign(footer.style, {
            padding: "10px",
            borderTop: "1px solid #444",
            backgroundColor: "#333",
        });

        const createWatchlistButton = this.#createButton({
            id: "createWatchlistButton",
            text: "Create a new watchlist",
            onClick: () => {
                const watchlistName = prompt("Enter a name for the new watchlist:");
                if (watchlistName) {
                    if (!this.#watchlists[watchlistName]) {
                        this.#watchlists[watchlistName] = [];
                        localStorage.setItem("watchlists", JSON.stringify(this.#watchlists));
                        this.#refreshWatchlistPopupContent(content);
                    } else {
                        alert(`Watchlist '${watchlistName}' already exists`);
                    }
                }
            },
            styles: {
                width: "100%",
                padding: "8px",
                backgroundColor: "#555",
                border: "none",
                color: "white",
                borderRadius: "3px",
            },
        });

        footer.appendChild(createWatchlistButton);

        popup.appendChild(header);
        popup.appendChild(content);
        popup.appendChild(footer);

        document.body.appendChild(popup);
        this.#refreshWatchlistPopupContent(content);
    };

    #refreshWatchlistPopupContent = (content) => {
        content.innerHTML = "";

        if (Object.keys(this.#watchlists).length === 0) {
            const emptyMessage = document.createElement("p");
            emptyMessage.textContent = "No available watchlists";
            emptyMessage.style.textAlign = "center";
            emptyMessage.style.color = "#888";
            content.appendChild(emptyMessage);
            return;
        }

        for (const watchlistName in this.#watchlists) {
            const watchlist = this.#watchlists[watchlistName];

            const watchlistSection = document.createElement("div");
            Object.assign(watchlistSection.style, {
                marginBottom: "20px",
                backgroundColor: "#333",
                borderRadius: "5px",
                padding: "10px",
            });

            // Заголовок вотчлиста
            const watchlistHeader = document.createElement("div");
            Object.assign(watchlistHeader.style, {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "10px",
            });

            // Кнопка-стрелочка (свёрнут/развёрнут)
            const collapseBtn = document.createElement("span");
            collapseBtn.style.cursor = "pointer";
            collapseBtn.style.marginRight = "10px";
            collapseBtn.textContent = this.#watchlistCollapseState[watchlistName] ? "▶" : "▼";
            collapseBtn.onclick = () => {
                this.#watchlistCollapseState[watchlistName] = !this.#watchlistCollapseState[watchlistName];
                this.#refreshWatchlistPopupContent(content);
            };

            const titleWrapper = document.createElement("div");
            titleWrapper.style.display = "flex";
            titleWrapper.style.alignItems = "center";

            const watchlistTitle = document.createElement("h4");
            watchlistTitle.textContent = watchlistName;
            watchlistTitle.style.margin = "0";

            titleWrapper.appendChild(collapseBtn);
            titleWrapper.appendChild(watchlistTitle);

            const buttonsContainer = document.createElement("div");
            buttonsContainer.style.display = "flex";
            buttonsContainer.style.gap = "5px";

            // Переименовать
            const renameButton = this.#createButton({
                id: `rename_${watchlistName}`,
                text: "✏️",
                onClick: () => {
                    const newName = prompt("Enter a new name for the watchlist:", watchlistName);
                    if (newName && newName !== watchlistName) {
                        if (!this.#watchlists[newName]) {
                            this.#watchlists[newName] = this.#watchlists[watchlistName];
                            delete this.#watchlists[watchlistName];

                            // Перенос timestamps
                            if (this.#watchlistTimestamps[watchlistName]) {
                                this.#watchlistTimestamps[newName] = this.#watchlistTimestamps[watchlistName];
                                delete this.#watchlistTimestamps[watchlistName];
                                localStorage.setItem("watchlistTimestamps", JSON.stringify(this.#watchlistTimestamps));
                            }

                            // Перенос заметок
                            if (this.#notes[watchlistName]) {
                                this.#notes[newName] = this.#notes[watchlistName];
                                delete this.#notes[watchlistName];
                                localStorage.setItem("notes", JSON.stringify(this.#notes));
                            }

                            localStorage.setItem("watchlists", JSON.stringify(this.#watchlists));
                            this.#refreshWatchlistPopupContent(content);
                        } else {
                            alert(`Watchlist '${newName}' already exists`);
                        }
                    }
                },
                styles: {
                    padding: "3px 6px",
                    backgroundColor: "#444",
                    border: "none",
                    borderRadius: "3px",
                },
            });

            // Очистить
            const clearButton = this.#createButton({
                id: `clear_${watchlistName}`,
                text: "🧹",
                onClick: () => {
                    if (confirm(`Clear the watchlist '${watchlistName}'?`)) {
                        this.#watchlists[watchlistName] = [];
                        if (this.#notes[watchlistName]) {
                            delete this.#notes[watchlistName];
                            localStorage.setItem("notes", JSON.stringify(this.#notes));
                        }
                        if (this.#watchlistTimestamps[watchlistName]) {
                            delete this.#watchlistTimestamps[watchlistName];
                            localStorage.setItem("watchlistTimestamps", JSON.stringify(this.#watchlistTimestamps));
                        }
                        localStorage.setItem("watchlists", JSON.stringify(this.#watchlists));
                        this.#refreshWatchlistPopupContent(content);
                    }
                },
                styles: {
                    padding: "3px 6px",
                    backgroundColor: "#444",
                    border: "none",
                    borderRadius: "3px",
                },
            });

            // Удалить весь вотчлист
            const deleteButton = this.#createButton({
                id: `delete_${watchlistName}`,
                text: "❌",
                onClick: () => {
                    if (confirm(`Delete the watchlist '${watchlistName}'?`)) {
                        delete this.#watchlists[watchlistName];
                        if (this.#notes[watchlistName]) {
                            delete this.#notes[watchlistName];
                            localStorage.setItem("notes", JSON.stringify(this.#notes));
                        }
                        if (this.#watchlistTimestamps[watchlistName]) {
                            delete this.#watchlistTimestamps[watchlistName];
                            localStorage.setItem("watchlistTimestamps", JSON.stringify(this.#watchlistTimestamps));
                        }
                        localStorage.setItem("watchlists", JSON.stringify(this.#watchlists));
                        this.#refreshWatchlistPopupContent(content);
                    }
                },
                styles: {
                    padding: "3px 6px",
                    backgroundColor: "#444",
                    border: "none",
                    borderRadius: "3px",
                },
            });

            buttonsContainer.appendChild(renameButton);
            buttonsContainer.appendChild(clearButton);
            buttonsContainer.appendChild(deleteButton);

            watchlistHeader.appendChild(titleWrapper);
            watchlistHeader.appendChild(buttonsContainer);
            watchlistSection.appendChild(watchlistHeader);

            // Если свёрнут
            if (this.#watchlistCollapseState[watchlistName]) {
                const collapsedInfo = document.createElement("p");
                collapsedInfo.style.color = "#aaa";
                collapsedInfo.style.textAlign = "center";
                collapsedInfo.style.margin = "0";
                watchlistSection.appendChild(collapsedInfo);
            } else {
                // Развёрнут
                if (watchlist.length === 0) {
                    const emptyMessage = document.createElement("p");
                    emptyMessage.textContent = "The watchlist is empty.";
                    emptyMessage.style.textAlign = "center";
                    emptyMessage.style.color = "#888";
                    watchlistSection.appendChild(emptyMessage);
                } else {
                    const coinsList = document.createElement("div");
                    coinsList.style.display = "flex";
                    coinsList.style.flexDirection = "column";
                    coinsList.style.gap = "5px";

                    watchlist.forEach((coinName) => {
                        const coinItem = document.createElement("div");
                        Object.assign(coinItem.style, {
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "5px 10px",
                            backgroundColor: "#444",
                            borderRadius: "3px",
                        });

                        const coinInfo = document.createElement("div");
                        coinInfo.style.flex = "1";
                        coinInfo.style.cursor = "pointer";
                        coinInfo.onclick = () => {
                            this.#lastClickedCoin = coinName;
                            this.#showContainer();
                            this.#startSearch(coinName);
                            document.getElementById("watchlistPopup").remove();
                        };

                        const coinSymbol = document.createElement("span");
                        coinSymbol.textContent = coinName;
                        coinSymbol.style.color = "#33c1ff";
                        coinSymbol.style.marginRight = "8px";

                        const addTime =
                            this.#watchlistTimestamps[watchlistName]?.[coinName] || "";
                        const coinDate = document.createElement("small");
                        coinDate.style.color = "#aaa";
                        coinDate.textContent = addTime ? `(${addTime})` : "";

                        coinInfo.appendChild(coinSymbol);
                        coinInfo.appendChild(coinDate);

                        // Есть ли заметка
                        const note = this.#notes[watchlistName]?.[coinName];
                        if (note) {
                            const noteText = document.createElement("small");
                            noteText.textContent = note;
                            noteText.style.display = "block";
                            noteText.style.color = "#888";
                            noteText.style.fontSize = "0.8em";
                            coinInfo.appendChild(noteText);
                        }

                        const coinButtons = document.createElement("div");
                        coinButtons.style.display = "flex";
                        coinButtons.style.gap = "5px";

                        const noteButton = this.#createButton({
                            id: `note_${watchlistName}_${coinName}`,
                            text: "✍️",
                            onClick: () => {
                                const currentNote = this.#notes[watchlistName]?.[coinName] || "";
                                const newNote = prompt("Enter a note for the coin:", currentNote);

                                if (newNote !== null) {
                                    if (!this.#notes[watchlistName]) {
                                        this.#notes[watchlistName] = {};
                                    }
                                    this.#notes[watchlistName][coinName] = newNote;
                                    localStorage.setItem("notes", JSON.stringify(this.#notes));
                                    this.#refreshWatchlistPopupContent(content);
                                }
                            },
                            styles: {
                                padding: "2px 5px",
                                backgroundColor: "#555",
                                border: "none",
                                borderRadius: "3px",
                            },
                        });

                        const removeButton = this.#createButton({
                            id: `remove_${watchlistName}_${coinName}`,
                            text: "🗑️",
                            onClick: () => {
                                this.#toggleCoinInWatchlist(watchlistName, coinName);
                                this.#refreshWatchlistPopupContent(content);
                            },
                            styles: {
                                padding: "2px 5px",
                                backgroundColor: "#555",
                                border: "none",
                                borderRadius: "3px",
                            },
                        });

                        coinButtons.appendChild(noteButton);
                        coinButtons.appendChild(removeButton);

                        coinItem.appendChild(coinInfo);
                        coinItem.appendChild(coinButtons);
                        coinsList.appendChild(coinItem);
                    });

                    watchlistSection.appendChild(coinsList);
                }
            }

            content.appendChild(watchlistSection);
        }
    };

    /**
     * История кликов
     */
    #createHistoryPopup = () => {
        const existingPopup = document.getElementById("historyPopup");
        if (existingPopup) {
            existingPopup.remove();
        }

        const historyPopup = document.createElement("div");
        historyPopup.id = "historyPopup";
        Object.assign(historyPopup.style, {
            position: "fixed",
            width: "400px",
            height: "500px",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            backgroundColor: "#222",
            color: "white",
            zIndex: "2000",
            border: "1px solid #666",
            borderRadius: "5px",
            boxShadow: "0 2px 10px rgba(0,0,0,0.5)",
            display: "flex",
            flexDirection: "column",
        });

        const header = document.createElement("div");
        header.style.display = "flex";
        header.style.justifyContent = "space-between";
        header.style.alignItems = "center";
        header.style.padding = "10px";
        header.style.backgroundColor = "#333";
        header.style.borderBottom = "1px solid #444";

        const title = document.createElement("h3");
        title.textContent = "История кликов";
        title.style.margin = "0";

        const closeButton = this.#createButton({
            id: "closeHistoryPopup",
            text: "✖",
            onClick: () => historyPopup.remove(),
            styles: {
                backgroundColor: "transparent",
                border: "none",
                color: "white",
                fontSize: "20px",
                padding: "0 5px",
            },
        });

        header.appendChild(title);
        header.appendChild(closeButton);

        const content = document.createElement("div");
        content.style.flex = "1";
        content.style.overflowY = "auto";
        content.style.padding = "10px";

        if (this.#history.length === 0) {
            const emptyMessage = document.createElement("p");
            emptyMessage.textContent = "История пуста";
            emptyMessage.style.textAlign = "center";
            emptyMessage.style.color = "#888";
            content.appendChild(emptyMessage);
        } else {
            const historyList = document.createElement("ul");
            historyList.style.listStyle = "none";
            historyList.style.padding = "0";

            this.#history.forEach((entry) => {
                const listItem = document.createElement("li");
                listItem.style.padding = "5px 0";
                listItem.style.borderBottom = "1px solid #444";

                const coinSpan = document.createElement("span");
                coinSpan.textContent = entry.coin;
                coinSpan.style.cursor = "pointer";
                coinSpan.style.color = "#33c1ff";
                coinSpan.onclick = () => {
                    this.#lastClickedCoin = entry.coin;
                    this.#showContainer();
                    this.#startSearch(entry.coin);
                    historyPopup.remove();
                };

                const timeSpan = document.createElement("span");
                timeSpan.textContent = ` - ${entry.time}`;
                timeSpan.style.color = "#888";
                timeSpan.style.fontSize = "0.9em";

                listItem.appendChild(coinSpan);
                listItem.appendChild(timeSpan);
                historyList.appendChild(listItem);
            });

            content.appendChild(historyList);
        }

        const footer = document.createElement("div");
        footer.style.padding = "10px";
        footer.style.borderTop = "1px solid #444";
        footer.style.backgroundColor = "#333";
        footer.style.textAlign = "right";

        const clearHistoryButton = this.#createButton({
            id: "clearHistoryButton",
            text: "Очистить историю",
            onClick: () => {
                if (confirm("Вы уверены, что хотите очистить историю?")) {
                    this.#history = [];
                    localStorage.setItem("history", JSON.stringify(this.#history));
                    this.#createHistoryPopup();
                }
            },
            styles: {
                padding: "8px 12px",
                backgroundColor: "#555",
                border: "none",
                color: "white",
                borderRadius: "3px",
                cursor: "pointer",
            },
        });

        footer.appendChild(clearHistoryButton);

        historyPopup.appendChild(header);
        historyPopup.appendChild(content);
        historyPopup.appendChild(footer);

        document.body.appendChild(historyPopup);
    };
}

new IframeManager();
