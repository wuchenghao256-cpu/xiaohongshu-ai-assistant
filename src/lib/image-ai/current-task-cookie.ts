/**
 * 「当前创作轮次」的客户端标记。
 *
 * 存在 cookie 而不是 sessionStorage：/create 是服务端组件，刷新时必须能读到上一轮的
 * task_id 才能判断这一轮还能不能接着用（额度满没满）。写成 session cookie，
 * 生命周期与 sessionStorage 一致——刷新保留、关掉标签页就没了。
 *
 * 它只是「候选 id」，不是权限：服务端仍会按 user_id 校验归属，并自己从 assets 计数
 * 重新判断轮次状态，所以 client 无法通过改这个值绕过 9 张上限。
 */
export const CURRENT_TASK_COOKIE = "xhs-current-content-task";
