const WEBHOOK_REGEX = /https:\/\/discord(app)?.com\/api\/webhooks\/([^\/]+)\/([^\/]+)/;
const ROLEID_REGEX = /^[0-9]+$/;

const EMBED_TEXT = [
    '가끔씩 낮잠을 자다가 총 12시간 정도 잠을 자는 경우가 있는데, 친구에게「수면의 질을 높이는 보충제를 먹으면, 두 번 자지 않고 상쾌하게 일어날 수 있게 될 거야.」라는 말을 듣고 시도해보니, 최고 품질의 12시간 수면에 성공했습니다!!!좋은 아침입니다!!오늘 아무것도 하지 않습니다!!!',
    '오랜만에 여름을 느낄 수 있는 곡을 쓸 수 있었어요.<br>역시 일본풍의 곡을 좋아한다.여름이 끝날 때까지 기다릴 수 있을까?.',
    '마후사카에서 놀고 왔습니다<br><br>마후「오늘 아침까지 일했어! 하지만 노는 재미로 열심히 놀 수 있었어요 ദ്ദി ˃ ᵕ ˂ )」<br><br>사카타 「잠을 푹 자야 머리가 돌아가지 않겠지~!오늘은 많이 놀자( ˶ˊᵕˋ˶)˶」<br><br>마후 「그래~!사카타는 항상 잘 자지 않는 것 같아!」<br><br>사카타 「하 ?」',
    '우라타 씨와의 콜라보레이션 영상이 올라왔습니다!<br><br>곡의 편곡을 담당했습니다!<br><br>그리고 언어화하기는 어렵지만, 공주님으로 노래하고 있습니다.비교적 귀엽다고 생각합니다.',
    '택시 내릴 때 실수로 "잘 먹었습니다."라고 말해 버려서, 부끄러워서 당황해서 내렸는데 발이 걸려 낮 신주쿠역 앞에서 공중제비를 했다.안녕히 계십시요。',
    '치과에서<br><br>선생님「다른 궁금한 점이 있나요??」<br>복「아, ..... ぉお...」<br>선생님「사랑니가 있네요~!!큰 병원의  소개장을 발급해드리겠습니다.!다음 예약이 가능한가요??」<br>복「예.. 아......ｯ네〃ｯ!!!」<br>선생님「인터넷 예약이군요~!! 알겠습니다!」<br><br>한심한<br>',
    '제가 좋아하는 홋카이도에 다녀왔습니다.<br>며칠간 컴퓨터와 떨어져 있었지만, 아무 일 없는 평화로운 세상은 제대로 있어 마 음이 편해졌습니다.<br>이번 달부터 연말까지 대대적인 발표를 할 예정입니다.<br><br>참고로 이 사진은 뷔페에 대한 욕심쟁이  챔피언십... 15분 동안 돌아다니다가 찍은 사진입니다.',
    '외출을 위해 변장했습니다<br>지금을 사는 닌자의 취향입니다',
    '오늘의 비정기 마후마후 밥<br><br>마후마후 분노의 분해 오므라이스<br><br>너무 무리해서 미쳐버렸다'
]

window.addEventListener('load', page_onLoad)

const popup_element = document.getElementsByClassName('popup_dim')[0];
const webhookInputElement = document.getElementById('webhookURL');
const mentionIdInputElement = document.getElementById('roleId');
const formElement = document.getElementById('registerForm');
const allowMentionElement = document.getElementById('allowMention');
const allowReceiveNotiElement = document.getElementById('allowReceiveNoti');
const embedContent = document.getElementsByClassName('embed-content')[0];

webhookInputElement.addEventListener('input', on_formChanged)
mentionIdInputElement.addEventListener('input', on_formChanged)

function changeRoleIDStatus(event) {
    mentionIdInputElement.disabled = !event.target.checked;
}

function vaildateValue() {
    let roleID = mentionIdInputElement.value;
    let webhookURL = webhookInputElement.value;
    let isVaildate = true;

    if (!!!webhookURL.match(WEBHOOK_REGEX)) {
        webhookInputElement.setCustomValidity('올바른 웹후크 URL이 아님');
        isVaildate = false;
    } else {
        webhookInputElement.setCustomValidity('');

    }

    if (roleID.trim() == '@everyone' ||
        roleID.trim() == '@here' ||
        !!roleID.match(ROLEID_REGEX)) {
        mentionIdInputElement.setCustomValidity('');
    } else {
        mentionIdInputElement.setCustomValidity('올바른 맨션 형식이 아님');
        isVaildate = false;
    }

    formElement.classList.add('was-validated')

    return isVaildate;
}

function on_formChanged() {
    vaildateValue();
}

function openRegister() {
    popup_element.classList.remove('hidden');
    webhookInputElement.value = '';
    allowMentionElement.checked = false;
    mentionIdInputElement.value = '@everyone';
    mentionIdInputElement.disabled = true;
    allowReceiveNotiElement.checked = true;
}

function closeRegister() {
    popup_element.classList.add('hidden');
}

function showSuccess(text) {
    document.getElementById('success').innerText = text;
    document.getElementById('success').classList.remove('alert-hidden');
    setTimeout(() => document.getElementById('success').classList.add('alert-hidden'), 2000);
}

function showError(text) {
    document.getElementById('error').innerText = text;
    document.getElementById('error').classList.remove('alert-hidden');
    setTimeout(() => document.getElementById('error').classList.add('alert-hidden'), 2000);
}

function enableButtons() {
    document.querySelector('.delete').disabled = false
    document.querySelector('.subscribe').disabled = false;
    document.querySelector('.edit').disabled = false;
}

function disableButtons() {
    document.querySelector('.delete').disabled = true;
    document.querySelector('.subscribe').disabled = true;
    document.querySelector('.edit').disabled = true;

}

async function registerWebhook() {
    let webhookURL = webhookInputElement.value;
    let roleID = allowMentionElement.checked ? mentionIdInputElement.value : -1;
    let allowSendNoti = allowReceiveNotiElement.checked;

    disableButtons();

    if (!vaildateValue()) return;

    try {
        let response = await (await fetch('/api/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: webhookURL,
                roleID: roleID,
                sendNoti: allowSendNoti
            })
        })).json();
        if (response.status == -2) showError('웹후크 등록에 실패했습니다: ' + response.message);
        else if (response.status != 0) throw new Error();
        else showSuccess('웹후크 등록 성공!');
    } catch {
        showError('웹후크 등록에 실패했습니다: 알 수 없는 오류가 발생하였습니다.')
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
        let response = await (await fetch('/api/edit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: webhookURL,
                roleID: roleID,
                sendNoti: allowSendNoti
            })
        })).json();

        if (response.status != 0) throw new Error();
        showSuccess('웹후크 수정 성공!');
    } catch {
        showError('웹후크 수정에 실패했습니다: 알 수 없는 오류가 발생하였습니다.')
    }
    closeRegister();
}

async function unregisterWebhook() {
    let webhookURL = webhookInputElement.value;

    if (!!!webhookURL.match(WEBHOOK_REGEX)) {
        webhookInputElement.setCustomValidity('aw');
        formElement.classList.add('was-validate');
        return;
    } else
        webhookInputElement.setCustomValidity('');

    try {
        let response = await (await fetch('/api/unregister?url=' + encodeURIComponent(webhookURL), {
            method: 'DELETE'
        })).json();

        if (response.status != 0) throw new Error();
        showSuccess('웹후크 삭제 성공!');
    } catch {
        showError('웹후크 삭제에 실패했습니다: 알 수 없는 오류가 발생하였습니다.')
    }
    closeRegister();
}

let embed_idx = 0;

function page_onLoad() {
    embedContent.innerHTML = EMBED_TEXT[embed_idx];
    setInterval(transform_embed_text, 5000)

    getNoticeList();
}

function transform_embed_text() {
    embedContent.style.maxHeight = '0vh';
    embedContent.style.opacity = '0';
    embed_idx = (embed_idx + 1) % EMBED_TEXT.length
    setTimeout(() => embedContent.innerHTML = EMBED_TEXT[embed_idx], 500);
    setTimeout(() => {
        embedContent.style.maxHeight = '100vh';
        embedContent.style.opacity = '1';
    }, 750);
}

function createNoticeItem(title, date, content) {
    const noticeItem = document.createElement('div');
    const titleItem = document.createElement('span');
    titleItem.classList.add('h3');
    const dateItem = document.createElement('span');
    const contentItem = document.createElement('p');
    const splitLine = document.createElement('hr');

    let uploadDate = new Date(date);

    noticeItem.classList.add('notice-item');
    titleItem.textContent = title;
    dateItem.textContent = `${uploadDate.getFullYear()}-${uploadDate.getMonth()+1}-${uploadDate.getDate()}`;
    contentItem.textContent = content;
    contentItem.style.marginTop = '10px';
    contentItem.style.whiteSpace = 'pre';
    noticeItem.appendChild(titleItem);
    noticeItem.appendChild(document.createElement('br'));
    noticeItem.appendChild(dateItem);
    noticeItem.appendChild(contentItem);
    noticeItem.appendChild(splitLine);

    return noticeItem;
}

async function getNoticeList() {
    const noticeList = document.getElementsByClassName('notice-list')[0];
    try {
        let res = await fetch('/api/getNotices');
        let notices = await res.json();
        if (!!!notices.data.length) {
            noticeList.innerHTML = '<span>아직 올라온 공지가 없네요 ¯\\(°_o)/¯</span>';
            return;
        }
        for (let i of notices.data) {
            noticeList.appendChild(createNoticeItem(i.title, i.date, i.content));
        }
    } catch (e) {
        console.error(e);
        noticeList.innerHTML = '<span>공지사항을 불러오는데 실패하였습니다.</span>';
    }
}