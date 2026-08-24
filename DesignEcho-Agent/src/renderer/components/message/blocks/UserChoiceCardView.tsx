/**
 * 选项卡：Agent 只为实质偏好、用户事实或授权列 1–3 个问题、每题 2–5 个选项。
 * 单题：点一个立刻提交；多题：逐题选好再一起提交。提交只携带结构化用户答案，
 * ChatPanel 会按来源消息恢复原任务，不通过普通发送管线另建任务。已提交后只读展示。
 */

import { useState } from 'react';
import type { InteractiveCardBlock as InteractiveCardBlockType } from '../types';
import type { InteractiveCardDefinition } from '../../../../shared/interactive-card-contract';
import {
    canDelegateUserChoiceQuestion,
    canSubmitUserChoiceAnswers,
    formatUserChoiceReply,
    type UserChoiceAnswer,
    type UserChoiceQuestion,
    type UserChoiceRequest
} from '../../../../shared/user-choice-request';
import './UserChoiceCardView.css';

interface UserChoiceCardViewProps {
    block: InteractiveCardBlockType;
    card: InteractiveCardDefinition<UserChoiceRequest>;
    onAction?: (actionId: string, params?: Record<string, any>) => void;
}

function QuestionBlock({
    question,
    answer,
    disabled,
    onPick,
    onFreeText,
    allowFreeText
}: {
    question: UserChoiceQuestion;
    answer?: UserChoiceAnswer;
    disabled: boolean;
    onPick: (optionId: string) => void;
    onFreeText: (text: string) => void;
    allowFreeText: boolean;
}): React.ReactElement {
    return (
        <div className="user-choice-question-block" data-question-id={question.id}>
            <p className="user-choice-question">{question.question}</p>
            {question.why ? <p className="user-choice-why">{question.why}</p> : null}
            <div className="user-choice-options" role="group" aria-label={question.question}>
                {question.options.map((option) => {
                    const isRecommended = option.id === question.recommendedId;
                    const isPicked = answer?.optionId === option.id;
                    return (
                        <button
                            key={option.id}
                            type="button"
                            className={`user-choice-option${isRecommended ? ' is-recommended' : ''}${isPicked ? ' is-picked' : ''}`}
                            disabled={disabled}
                            onClick={() => onPick(option.id)}
                        >
                            <span className="user-choice-option-label">
                                {option.label}
                                {isRecommended ? <span className="user-choice-badge">Agent 倾向</span> : null}
                            </span>
                            {option.detail ? <span className="user-choice-option-detail">{option.detail}</span> : null}
                        </button>
                    );
                })}
            </div>
            {allowFreeText && !disabled ? (
                <input
                    className="user-choice-free-input"
                    type="text"
                    value={answer?.freeText || ''}
                    placeholder="都不是？写一句…"
                    onChange={(event) => onFreeText(event.target.value)}
                />
            ) : null}
        </div>
    );
}

export function UserChoiceCardView({ block, card, onAction }: UserChoiceCardViewProps): React.ReactElement {
    const request = card.payload;
    const questions = Array.isArray(request?.questions) ? request.questions : [];
    const single = questions.length === 1;
    const [answers, setAnswers] = useState<UserChoiceAnswer[]>([]);
    const [sent, setSent] = useState(false);
    const submitted = Boolean(block.submission) || sent;

    const send = (finalAnswers: UserChoiceAnswer[]): void => {
        if (submitted) return;
        setSent(true);
        onAction?.('submitUserChoice', {
            text: formatUserChoiceReply(request, finalAnswers),
            cardId: card.id,
            sourceMessageId: block.sourceMessageId
        });
    };
    const upsert = (next: UserChoiceAnswer): UserChoiceAnswer[] => {
        const rest = answers.filter((item) => item.questionId !== next.questionId);
        const merged = [...rest, next];
        setAnswers(merged);
        return merged;
    };
    const pick = (questionId: string, optionId: string): void => {
        const merged = upsert({ questionId, optionId, freeText: answers.find((a) => a.questionId === questionId)?.freeText });
        if (single) send(merged);
    };
    const setFree = (questionId: string, freeText: string): void => {
        upsert({ questionId, optionId: answers.find((a) => a.questionId === questionId)?.optionId, freeText });
    };
    const answeredCount = questions.filter((question) => {
        const answer = answers.find((item) => item.questionId === question.id);
        return Boolean(answer?.optionId || String(answer?.freeText || '').trim());
    }).length;
    const canSubmit = canSubmitUserChoiceAnswers(request, answers);
    const canDelegateAll = questions.every(canDelegateUserChoiceQuestion);

    return (
        <section className="user-choice-card" data-testid="user-choice-card" data-card-id={card.id}>
            {request?.intro ? <p className="user-choice-intro">{request.intro}</p> : null}
            {questions.map((question) => (
                <QuestionBlock
                    key={question.id}
                    question={question}
                    answer={answers.find((item) => item.questionId === question.id)}
                    disabled={submitted}
                    onPick={(optionId) => pick(question.id, optionId)}
                    onFreeText={(text) => setFree(question.id, text)}
                    allowFreeText={request.allowFreeText !== false}
                />
            ))}
            {!submitted ? (
                <div className="user-choice-footer">
                    {!single ? (
                        <button
                            type="button"
                            className="user-choice-send"
                            disabled={answeredCount === 0 || !canSubmit}
                            onClick={() => send(answers)}
                        >
                            发送{answeredCount < questions.length ? `（已选 ${answeredCount}/${questions.length}，未选偏好由它决定）` : ''}
                        </button>
                    ) : null}
                    {single && String(answers[0]?.freeText || '').trim() ? (
                        <button type="button" className="user-choice-send" onClick={() => send(answers)}>发送</button>
                    ) : null}
                    {canDelegateAll ? (
                        <button type="button" className="user-choice-auto" onClick={() => send([])}>
                            都你自己定
                        </button>
                    ) : null}
                </div>
            ) : (
                <p className="user-choice-done">已回复</p>
            )}
        </section>
    );
}
