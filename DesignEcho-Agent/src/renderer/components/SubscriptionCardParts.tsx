import React from 'react';

interface SubscriptionInfoItemProps {
    label: string;
    value: React.ReactNode;
    /** 悬停时展示的完整内容，供长取值（脱敏邮箱、带型号的验证状态）使用。 */
    title?: string;
}

/**
 * 订阅卡里的一条「标签 + 取值」，ChatGPT / Claude 两张卡共用同一套密度。
 * 取值超出列宽时按默认规则换行，不做单行截断——设置页的数据以读全为先。
 */
export function SubscriptionInfoItem(props: SubscriptionInfoItemProps): JSX.Element {
    return (
        <div className="subscription-card__item">
            <span className="subscription-card__label">{props.label}</span>
            <span className="subscription-card__value" title={props.title}>{props.value}</span>
        </div>
    );
}
