const readline = require('readline');
const { stdin: input, stdout: output } = require('node:process');

readline.createInterface({input, output}).question('Please paste cookie section:\n', (raw_cookie) => {
    let cookies = {};
    raw_cookie = raw_cookie.split(';');

    raw_cookie.forEach(element => {
        let key = element.substring(0, element.indexOf('='));
        let value = element.substring(element.indexOf('=') + 1);
        cookies[key.trim()] = value.trim();
    });

    // {
    //     'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36',
    //     'Referer': 'https://twitter.com/',
    //     'x-csrf-token': 'f1755ccd05b36fbca22e95aa107898df88a103831b0c1fd04196113509cf7a0f62da4bb8ff74e6e4dbb7f16eda804c544d811226c6950835b98b11011528dcb3255fa1a4cbf9763fe480cd8613f6fdfc',
    //     'Cookie': `auth_token=eebf2a6eef74688ba611c4ecde1ff80b444ede49;ct0=f1755ccd05b36fbca22e95aa107898df88a103831b0c1fd04196113509cf7a0f62da4bb8ff74e6e4dbb7f16eda804c544d811226c6950835b98b11011528dcb3255fa1a4cbf9763fe480cd8613f6fdfc;`,
    //     'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
    //     'x-twitter-auth-type': 'OAuth2Session',
    //     'x-twitter-active-user': 'yes',
    //     'x-twitter-client-language': 'en'
    // }

    console.log(cookies)

    let headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36',
        'Referer': 'https://twitter.com/',
        'x-csrf-token': cookies['ct0'],
        'Cookie': `auth_token=${cookies['auth_token']};ct0=${cookies['ct0']}`,
        'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
        'x-twitter-active-user': 'yes',
        'x-twitter-client-language': 'en'
    };

    console.log(JSON.stringify(headers, null, 4))
    process.exit(0);
});