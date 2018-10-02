// @flow

import html2canvas from "html2canvas";
import * as React from "react";
import { fetchWrapper } from "../../common";
import { logEvent, toWorker } from ".";

const handleScreenshotClick = async e => {
    e.preventDefault();

    const contentEl = document.getElementById("actual-content");
    if (!contentEl) {
        throw new Error("Missing DOM element #actual-content");
    }

    // Add watermark
    const watermark = document.createElement("div");
    const navbarBrands = document.getElementsByClassName("navbar-brand");
    if (navbarBrands.length === 0) {
        return;
    }
    const navbarBrandParent = navbarBrands[0].parentElement;
    if (!navbarBrandParent) {
        return;
    }
    watermark.innerHTML = `<nav class="navbar navbar-default"><div class="container-fluid"><div class="navbar-header">${String(
        navbarBrandParent.innerHTML,
    )}</div><p class="navbar-text navbar-right" style="color: #000; font-weight: bold">Play your own league free at basketball-gm.com</p></div></nav>`;
    contentEl.insertBefore(watermark, contentEl.firstChild);
    contentEl.style.padding = "8px";

    // Add notifications
    const notifications = document
        .getElementsByClassName("notification-container")[0]
        .cloneNode(true);
    notifications.classList.remove("notification-container");
    for (let i = 0; i < notifications.childNodes.length; i++) {
        // Otherwise screeenshot is taken before fade in is complete
        const el = notifications.children[0];
        if (el.classList && typeof el.classList.remove === "function") {
            el.classList.remove("notification-fadein");
        }
    }
    contentEl.appendChild(notifications);

    const canvas = await html2canvas(contentEl, {
        background: "#fff",
    });

    // Remove watermark
    contentEl.removeChild(watermark);
    contentEl.style.padding = "";

    // Remove notifications
    contentEl.removeChild(notifications);

    logEvent({
        type: "screenshot",
        text: `Uploading your screenshot to Imgur...`,
        saveToDb: false,
        showNotification: true,
        persistent: false,
        extraClass: "notification-primary",
    });

    try {
        const data = await fetchWrapper({
            url: "https://imgur-apiv3.p.mashape.com/3/image",
            method: "POST",
            headers: {
                Authorization: "Client-ID c2593243d3ea679",
                "X-Mashape-Key":
                    "H6XlGK0RRnmshCkkElumAWvWjiBLp1ItTOBjsncst1BaYKMS8H",
            },
            data: {
                image: canvas.toDataURL().split(",")[1],
            },
        });

        if (data.data.error) {
            console.log(data.data.error);
            throw new Error(data.data.error.message);
        }

        const url = `http://imgur.com/${data.data.id}`;
        const encodedURL = window.encodeURIComponent(url);

        logEvent({
            type: "screenshot",
            text: `<p><a href="${url}" target="_blank">Click here to view your screenshot.</a></p>
<a href="https://www.reddit.com/r/BasketballGM/submit?url=${encodedURL}">Share on Reddit</a><br>
<a href="https://twitter.com/intent/tweet?url=${encodedURL}&via=basketball_gm">Share on Twitter</a>`,
            saveToDb: false,
            showNotification: true,
            persistent: true,
            extraClass: "notification-primary",
        });
    } catch (err) {
        console.log(err);
        let errorMsg;
        if (
            err &&
            err.responseJSON &&
            err.responseJSON.error &&
            err.responseJSON.error.message
        ) {
            errorMsg = `Error saving screenshot. Error message from Imgur: "${
                err.responseJSON.error.message
            }"`;
        } else if (err.message) {
            errorMsg = `Error saving screenshot. Error message from Imgur: "${
                err.message
            }"`;
        } else {
            errorMsg = "Error saving screenshot.";
        }
        logEvent({
            type: "error",
            text: errorMsg,
            saveToDb: false,
        });
    }
};

type MenuItemLink = {|
    type: "link",
    active?: string => boolean,
    league?: true,
    godMode?: true,
    nonLeague?: true,
    onClick?: (SyntheticEvent<>) => void | Promise<void>,
    path?: string | (number | string)[],
    text:
        | string
        | React.Element<any>
        | {
              side: string | React.Element<any>,
              top: string | React.Element<any>,
          },
|};
type MenuItemHeader = {|
    type: "header",
    long: string,
    short: string,
    league?: true,
    nonLeague?: true,
    children: MenuItemLink[],
|};

const menuItems: (MenuItemLink | MenuItemHeader)[] = [
    {
        type: "link",
        active: pageID => pageID === "leagueDashboard",
        league: true,
        path: [],
        text: {
            side: "Dashboard",
            top: (
                <>
                    <span className="glyphicon glyphicon-home" />
                    <span className="d-inline d-sm-none ml-2">
                        League Dashboard
                    </span>
                </>
            ),
        },
    },
    {
        type: "link",
        active: pageID => pageID === "dashboard",
        nonLeague: true,
        path: "/",
        text: "Leagues",
    },
    {
        type: "header",
        long: "League",
        short: "L",
        league: true,
        children: [
            {
                type: "link",
                active: pageID => pageID === "standings",
                league: true,
                path: ["standings"],
                text: "Standings",
            },
            {
                type: "link",
                active: pageID => pageID === "playoffs",
                league: true,
                path: ["playoffs"],
                text: "Playoffs",
            },
            {
                type: "link",
                active: pageID => pageID === "leagueFinances",
                league: true,
                path: ["league_finances"],
                text: "Finances",
            },
            {
                type: "link",
                active: pageID =>
                    pageID === "history" || pageID === "historyAll",
                league: true,
                path: ["history_all"],
                text: "History",
            },
            {
                type: "link",
                active: pageID => pageID === "powerRankings",
                league: true,
                path: ["power_rankings"],
                text: "Power Rankings",
            },
            {
                type: "link",
                active: pageID => pageID === "transactions",
                league: true,
                path: ["transactions", "all"],
                text: "Transactions",
            },
        ],
    },
    {
        type: "header",
        long: "Team",
        short: "T",
        league: true,
        children: [
            {
                type: "link",
                active: pageID => pageID === "roster",
                league: true,
                path: ["roster"],
                text: "Roster",
            },
            {
                type: "link",
                active: pageID => pageID === "schedule",
                league: true,
                path: ["schedule"],
                text: "Schedule",
            },
            {
                type: "link",
                active: pageID => pageID === "teamFinances",
                league: true,
                path: ["team_finances"],
                text: "Finances",
            },
            {
                type: "link",
                active: pageID => pageID === "teamHistory",
                league: true,
                path: ["team_history"],
                text: "History",
            },
        ],
    },
    {
        type: "header",
        long: "Players",
        short: "P",
        league: true,
        children: [
            {
                type: "link",
                active: pageID => pageID === "freeAgents",
                league: true,
                path: ["free_agents"],
                text: "Free Agents",
            },
            {
                type: "link",
                active: pageID => pageID === "trade",
                league: true,
                path: ["trade"],
                text: "Trade",
            },
            {
                type: "link",
                active: pageID => pageID === "tradingBlock",
                league: true,
                path: ["trading_block"],
                text: "Trading Block",
            },
            {
                type: "link",
                active: pageID => pageID === "draft",
                league: true,
                path: ["draft"],
                text: "Draft",
            },
            {
                type: "link",
                active: pageID => pageID === "watchList",
                league: true,
                path: ["watch_list"],
                text: "Watch List",
            },
            {
                type: "link",
                active: pageID => pageID === "hallOfFame",
                league: true,
                path: ["hall_of_fame"],
                text: "Hall of Fame",
            },
        ],
    },
    {
        type: "header",
        long: "Stats",
        short: "S",
        league: true,
        children: [
            {
                type: "link",
                active: pageID => pageID === "gameLog",
                league: true,
                path: ["game_log"],
                text: "Game Log",
            },
            {
                type: "link",
                active: pageID => pageID === "leaders",
                league: true,
                path: ["leaders"],
                text: "League Leaders",
            },
            {
                type: "link",
                active: pageID => pageID === "playerRatings",
                league: true,
                path: ["player_ratings"],
                text: "Player Ratings",
            },
            {
                type: "link",
                active: pageID => pageID === "playerStats",
                league: true,
                path: ["player_stats"],
                text: "Player Stats",
            },
            {
                type: "link",
                active: pageID => pageID === "teamStats",
                league: true,
                path: ["team_stats"],
                text: "Team Stats",
            },
            {
                type: "link",
                active: pageID => pageID === "playerFeats",
                league: true,
                path: ["player_feats"],
                text: "Statistical Feats",
            },
        ],
    },
    {
        type: "header",
        long: "Tools",
        short: "X",
        league: true,
        nonLeague: true,
        children: [
            {
                type: "link",
                active: pageID => pageID === "account",
                league: true,
                nonLeague: true,
                path: "/account",
                text: "Achievements",
            },
            {
                type: "link",
                league: true,
                onClick() {
                    toWorker("actions.toolsMenu.autoPlaySeasons");
                },
                text: "Auto Play",
            },
            {
                type: "link",
                active: pageID => pageID === "customizePlayer",
                godMode: true,
                league: true,
                path: ["customize_player"],
                text: "Create A Player",
            },
            {
                type: "link",
                active: pageID => pageID === "deleteOldData",
                league: true,
                path: ["delete_old_data"],
                text: "Delete Old Data",
            },
            {
                type: "link",
                active: pageID => pageID === "editTeamInfo",
                league: true,
                godMode: true,
                path: ["edit_team_info"],
                text: "Edit Team Info",
            },
            {
                type: "link",
                active: pageID => pageID === "eventLog",
                league: true,
                path: ["event_log"],
                text: "Event Log",
            },
            {
                type: "link",
                active: pageID => pageID === "exportLeague",
                league: true,
                path: ["export_league"],
                text: "Export League",
            },
            {
                type: "link",
                active: pageID => pageID === "exportStats",
                league: true,
                path: ["export_stats"],
                text: "Export Stats",
            },
            {
                type: "link",
                active: pageID => pageID === "fantasyDraft",
                league: true,
                path: ["fantasy_draft"],
                text: "Fantasy Draft",
            },
            {
                type: "link",
                active: pageID => pageID === "godMode",
                league: true,
                path: ["god_mode"],
                text: "God Mode",
            },
            {
                type: "link",
                active: pageID => pageID === "multiTeamMode",
                league: true,
                godMode: true,
                path: ["multi_team_mode"],
                text: "Multi Team Mode",
            },
            {
                type: "link",
                active: pageID => pageID === "newTeam",
                league: true,
                godMode: true,
                path: ["new_team"],
                text: "Switch Team",
            },
            {
                type: "link",
                active: pageID => pageID === "options",
                league: true,
                path: ["options"],
                text: "Options",
            },
            {
                type: "link",
                league: true,
                nonLeague: true,
                onClick: handleScreenshotClick,
                text: (
                    <span>
                        <span className="glyphicon glyphicon-camera" />{" "}
                        Screenshot
                    </span>
                ),
            },
            {
                type: "link",
                nonLeague: true,
                async onClick(e) {
                    e.preventDefault();
                    const response = await toWorker(
                        "actions.toolsMenu.resetDb",
                    );
                    if (response) {
                        window.location.reload();
                    }
                },
                text: "Delete All Leagues",
            },
            {
                type: "link",
                active: pageID => pageID === "dangerZone",
                league: true,
                path: ["danger_zone"],
                text: "Danger Zone",
            },
        ],
    },
    {
        type: "header",
        long: "Help",
        short: "?",
        league: true,
        nonLeague: true,
        children: [
            {
                type: "link",
                league: true,
                nonLeague: true,
                path: "https://basketball-gm.com/manual/",
                text: "Overview",
            },
            {
                type: "link",
                active: pageID => pageID === "changes",
                league: true,
                nonLeague: true,
                path: "/changes",
                text: "Changes",
            },
            {
                type: "link",
                league: true,
                nonLeague: true,
                path: "https://basketball-gm.com/manual/customization/",
                text: "Custom Rosters",
            },
            {
                type: "link",
                league: true,
                nonLeague: true,
                path: "https://basketball-gm.com/manual/debugging/",
                text: "Debugging",
            },
        ],
    },
];

export default menuItems;
