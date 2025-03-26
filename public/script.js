const WEBHOOK_REGEX =
    /https:\/\/discord(app)?.com\/api\/webhooks\/([^\/]+)\/([^\/]+)/;
const ROLEID_REGEX = /^[0-9]+$/;

const EMBED_TEXT = [
    `나 "나 오타쿠 같아?"<br /><br />
    친구 "전혀 그렇지 않아~"<br /><br />
    나 "이상한 점 있으면 뭐든지 말해줘"<br /><br />
    친구 "음....굳이 말하자면 말 시작할 때
    '앗'이라고 하는 거? 그리고 뭔가
    두리번거려!"<br /><br />
    나 ""<br /><br />
    친구 "얘기하면서 '크흐흐'처럼 웃는것도
    특이할지도 몰라!"`,
    `마후마후스러운 이름으로 게임하고 있었는데, 매치된 아군이 나를 마후마후의 시청자라고 생각했는지, "저도 마후쿤 좋아해요"라고 팀 채팅으로 말해줬다.
    그게 정말 기뻐서, 이기면 마후마후 본인입니다 감사합니다라고 말하려고 경기를 했다.
    내가 제일 못해서 지고 묵묵히 떠났다.`,
    `(┓^ω^)┛))요이사요이사♪(┓^ω^)┛))요이사요이사♪ (┓^ω^)┛))요이사요이사♪(┓^ω^)┛))요이사요이사♪ (┓^ω^)┛))요이사요이사♪(┓^ω^)┛))요이사요이사♪ (┓^ω^)┛))요이사요이사♪(┓^ω^)┛))요이사요이사♪ (┓^ω^)┛))요이사요이사♪(┓^ω^)┛))요이사요이사♪ (┓^ω^)┛))요이사요이사♪`,
    `라이브에서 준비해준 칫솔을 가지고 있었는데, 음식점 세면대에서 양치하려고 꺼냈더니 크게 ‘마후마후’라고 적혀 있었다. 이름도 부끄럽고, 옆에 있던 아저씨는 뭘 생각했을까.`,
    `대기실에서<br/><br/>우라「최근에, 마후도 사카타도 스마트폰 만질 때 말 걸면 대답을 안 하더라」<br/><br/>마후「우린 머리가 약간 모자라서 어려워요」<br/><br/>사카「도수는 다르지만! 마후가 6이나 7이라면, 난 4야!」<br/><br/>마후「에」<br/><br/>소라「내가 말하건대, 두 사람 다 이상한 방향으로 다르다」<br/><br/>마후사카「너도 그래!!」`,
    `마후사카로 신년고항회<br/><br/>사카「이 바보에는 이 츳코미가 웃기다는 계산식이 있단 말이지!」<br/><br/>마후「후후, 역시 사카탄!」<br/><br/>사카「3－4＋7이…어…7이라고 한다면?」<br/><br/>마후「7이 아니네!」<br/><br/>사카「좋은 츳코미네(キリッ」<br/><br/>마후「얼버무리지 마 33세」`,
    `달렸다!<br/>컨디션 회복해서 좋아! (⊃ ̫ )⊃<br/><br/>머리색은 감으면서 좋게 자연스러워진대! 좀 더 차분한 그레이가 되면 좋겠다˙˘˙)/<br/><br/>29일 기념일이니까 생방송<br/>31일 영상 업로드<br/>마후츠키 연말 방송<br/><br/>예정이야!<br/>연내에 다 같이 달려보자...(๑•̀ㅂ•́)و✧`,
];

window.addEventListener("load", page_onLoad);

const popup_element = document.getElementsByClassName("popup_dim")[0];
const webhookInputElement = document.getElementById("webhookURL");
const mentionIdInputElement = document.getElementById("roleId");
const formElement = document.getElementById("registerForm");
const allowMentionElement = document.getElementById("allowMention");
const allowReceiveNotiElement = document.getElementById("allowReceiveNoti");
const embedContent = document.getElementsByClassName("embed-content")[0];

webhookInputElement.addEventListener("input", on_formChanged);
mentionIdInputElement.addEventListener("input", on_formChanged);

function changeRoleIDStatus(event) {
    mentionIdInputElement.disabled = !event.target.checked;
}

function vaildateValue() {
    let roleID = mentionIdInputElement.value;
    let webhookURL = webhookInputElement.value;
    let isVaildate = true;

    if (!!!webhookURL.match(WEBHOOK_REGEX)) {
        webhookInputElement.setCustomValidity("올바른 웹후크 URL이 아님");
        isVaildate = false;
    } else {
        webhookInputElement.setCustomValidity("");
    }

    if (
        roleID.trim() == "@everyone" ||
        roleID.trim() == "@here" ||
        !!roleID.match(ROLEID_REGEX)
    ) {
        mentionIdInputElement.setCustomValidity("");
    } else {
        mentionIdInputElement.setCustomValidity("올바른 맨션 형식이 아님");
        isVaildate = false;
    }

    formElement.classList.add("was-validated");

    return isVaildate;
}

function on_formChanged() {
    vaildateValue();
}

function openRegister() {
    popup_element.classList.remove("hidden");
    webhookInputElement.value = "";
    allowMentionElement.checked = false;
    mentionIdInputElement.value = "@everyone";
    mentionIdInputElement.disabled = true;
    allowReceiveNotiElement.checked = true;
}

function closeRegister() {
    popup_element.classList.add("hidden");
}

function showSuccess(text) {
    document.getElementById("success").innerText = text;
    document.getElementById("success").classList.remove("alert-hidden");
    setTimeout(
        () => document.getElementById("success").classList.add("alert-hidden"),
        2000
    );
}

function showError(text) {
    document.getElementById("error").innerText = text;
    document.getElementById("error").classList.remove("alert-hidden");
    setTimeout(
        () => document.getElementById("error").classList.add("alert-hidden"),
        2000
    );
}

function enableButtons() {
    document.querySelector(".delete").disabled = false;
    document.querySelector(".subscribe").disabled = false;
    document.querySelector(".edit").disabled = false;
}

function disableButtons() {
    document.querySelector(".delete").disabled = true;
    document.querySelector(".subscribe").disabled = true;
    document.querySelector(".edit").disabled = true;
}

async function registerWebhook() {
    let webhookURL = webhookInputElement.value;
    let roleID = allowMentionElement.checked ? mentionIdInputElement.value : -1;
    let allowSendNoti = allowReceiveNotiElement.checked;

    disableButtons();

    if (!vaildateValue()) return;

    try {
        let response = await (
            await fetch("/api/register", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    url: webhookURL,
                    roleID: roleID,
                    sendNoti: allowSendNoti,
                }),
            })
        ).json();
        if (response.status == -2)
            showError("웹후크 등록에 실패했습니다: " + response.message);
        else if (response.status != 0) throw new Error();
        else showSuccess("웹후크 등록 성공!");
    } catch {
        showError(
            "웹후크 등록에 실패했습니다: 알 수 없는 오류가 발생하였습니다."
        );
    }
    enableButtons();
    closeRegister();
}

async function editWebhook() {
    let webhookURL = webhookInputElement.value;
    let roleID = allowMentionElement.checked ? mentionIdInputElement.value : -1;
    let allowSendNoti = allowReceiveNotiElement.checked;

    if (!vaildateValue()) return;

    try {
        let response = await (
            await fetch("/api/edit", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    url: webhookURL,
                    roleID: roleID,
                    sendNoti: allowSendNoti,
                }),
            })
        ).json();

        if (response.status == -2)
            showError("웹후크 등록에 실패했습니다: " + response.message);
        else if (response.status != 0) throw new Error();
        else showSuccess("웹후크 수정 성공!");
    } catch {
        showError(
            "웹후크 수정에 실패했습니다: 알 수 없는 오류가 발생하였습니다."
        );
    }
    closeRegister();
}

async function unregisterWebhook() {
    let webhookURL = webhookInputElement.value;

    if (!!!webhookURL.match(WEBHOOK_REGEX)) {
        webhookInputElement.setCustomValidity("aw");
        formElement.classList.add("was-validate");
        return;
    } else webhookInputElement.setCustomValidity("");

    try {
        let response = await (
            await fetch(
                "/api/unregister?url=" + encodeURIComponent(webhookURL),
                {
                    method: "DELETE",
                }
            )
        ).json();

        if (response.status == -2)
            showError("웹후크 등록에 실패했습니다: " + response.message);
        else if (response.status != 0) throw new Error();
        showSuccess("웹후크 삭제 성공!");
    } catch {
        showError(
            "웹후크 삭제에 실패했습니다: 알 수 없는 오류가 발생하였습니다."
        );
    }
    closeRegister();
}

let embed_idx = 0;

function page_onLoad() {
    embedContent.innerHTML = EMBED_TEXT[embed_idx];
    embedContent.parentElement.style.height =
        embedContent.parentElement.clientHeight + "px";
    setInterval(transform_embed_text, 5000);

    getNoticeList();
}

const EMBED_PADDING =
    embedContent.parentElement.clientHeight - embedContent.clientHeight;
function transform_embed_text() {
    embedContent.style.opacity = "0";
    embed_idx = (embed_idx + 1) % EMBED_TEXT.length;
    setTimeout(() => {
        embedContent.innerHTML = EMBED_TEXT[embed_idx];
    }, 250);
    setTimeout(() => {
        embedContent.style.opacity = "1";
    }, 500);
}

function createNoticeItem(title, date, content) {
    const noticeItem = document.createElement("div");
    const titleItem = document.createElement("span");
    titleItem.classList.add("h3");
    const dateItem = document.createElement("span");
    const contentItem = document.createElement("p");
    const splitLine = document.createElement("hr");

    let uploadDate = new Date(date);

    noticeItem.classList.add("notice-item");
    titleItem.textContent = title;
    dateItem.textContent = `${uploadDate.getFullYear()}-${
        uploadDate.getMonth() + 1
    }-${uploadDate.getDate()}`;
    contentItem.innerHTML = content.replace(/\n/g, "<br>");
    contentItem.style.marginTop = "10px";
    contentItem.style.width = "100%";
    contentItem.style.wordBreak = "break-all";
    // contentItem.style.whiteSpace = 'pre';
    noticeItem.appendChild(titleItem);
    noticeItem.appendChild(document.createElement("br"));
    noticeItem.appendChild(dateItem);
    noticeItem.appendChild(contentItem);
    noticeItem.appendChild(splitLine);

    return noticeItem;
}

async function getNoticeList() {
    const noticeList = document.getElementsByClassName("notice-list")[0];
    try {
        let res = await fetch("/api/getNotices");
        let notices = await res.json();
        if (!!!notices.data.length) {
            noticeList.innerHTML =
                "<span>아직 올라온 공지가 없네요 ¯\\(°_o)/¯</span>";
            return;
        }
        for (let i of notices.data) {
            noticeList.appendChild(
                createNoticeItem(i.title, i.date, i.content)
            );
        }
    } catch (e) {
        console.error(e);
        noticeList.innerHTML =
            "<span>공지사항을 불러오는데 실패하였습니다.</span>";
    }
}
