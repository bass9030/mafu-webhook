export interface WebhookOptions {
    isLINESend: boolean;
    isNotiSend: boolean;
    isMention: boolean;
}

export interface WebhookRow {
    channelID: string;
    webhookToken: string;
    options: number;
    roleID: string | number;
}

export interface Notice {
    date: Date | string;
    title: string;
    content: string;
}

export interface NoticeMessage {
    title: string;
    content: string;
}

export interface LineMessage {
    time: string | number;
    message: string;
}

export interface ApiResponse<T = never> {
    status: number;
    message?: string;
    data?: T;
}
